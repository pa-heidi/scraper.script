/**
 * Legal Compliance Service
 * Handles robots.txt checking, GDPR compliance, and legal metadata management
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */

import { URL } from 'url';
import crypto from 'crypto';
import {
  RobotsTxtRule,
  RobotsTxtCache,
  LegalMetadata,
  GDPRAnonymizationConfig,
  DataDeletionRequest,
  ComplianceCheckResult,
  ExtractedItem
} from '../interfaces/core';
import { logger } from '../utils/logger';

export class LegalComplianceService {
  private robotsCache: Map<string, RobotsTxtCache> = new Map();
  private readonly cacheExpiryHours = 24;
  private readonly userAgent = 'AI-Scraper-Service/1.0';

  constructor(
    private anonymizationConfig: GDPRAnonymizationConfig = {
      anonymizeEmails: true,
      anonymizePhones: true,
      anonymizeAddresses: false,
      anonymizeNames: false,
      hashSalt: process.env.GDPR_HASH_SALT || 'default-salt',
      preserveFormat: true
    }
  ) {}

  /**
   * Check if a URL is allowed by robots.txt
   * Requirement 3.1: Check and respect robots.txt rules
   */
  async isUrlAllowed(url: string, userAgent: string = this.userAgent): Promise<boolean> {
    try {
      const parsedUrl = new URL(url);
      const domain = parsedUrl.hostname;
      const path = parsedUrl.pathname;

      const robotsRules = await this.getRobotsTxtRules(domain);

      if (!robotsRules || robotsRules.length === 0) {
        // No robots.txt found, assume allowed
        return true;
      }

      // Find applicable rules for the user agent
      const applicableRules = this.findApplicableRules(robotsRules, userAgent);

      return this.checkPathAllowed(path, applicableRules);
    } catch (error) {
      logger.error('Error checking robots.txt compliance', { url, error: error instanceof Error ? error.message : String(error) });
      // On error, be conservative and assume not allowed
      return false;
    }
  }

  /**
   * Get robots.txt rules for a domain with caching
   * Requirement 3.1: Implement robots.txt parser and caching mechanism
   */
  async getRobotsTxtRules(domain: string): Promise<RobotsTxtRule[]> {
    const cached = this.robotsCache.get(domain);

    if (cached && cached.expiresAt > new Date() && cached.isValid) {
      return cached.rules;
    }

    try {
      const robotsTxtUrl = `https://${domain}/robots.txt`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(robotsTxtUrl, {
        headers: {
          'User-Agent': this.userAgent
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // No robots.txt file, cache empty rules
        const emptyCache: RobotsTxtCache = {
          domain,
          robotsTxt: '',
          rules: [],
          lastFetched: new Date(),
          expiresAt: new Date(Date.now() + this.cacheExpiryHours * 60 * 60 * 1000),
          isValid: true
        };
        this.robotsCache.set(domain, emptyCache);
        return [];
      }

      const robotsTxt = await response.text();
      const rules = this.parseRobotsTxt(robotsTxt);

      const cache: RobotsTxtCache = {
        domain,
        robotsTxt,
        rules,
        lastFetched: new Date(),
        expiresAt: new Date(Date.now() + this.cacheExpiryHours * 60 * 60 * 1000),
        isValid: true
      };

      this.robotsCache.set(domain, cache);
      return rules;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error fetching robots.txt', { domain, error: errorMessage });

      // Cache the error to avoid repeated failed requests
      const errorCache: RobotsTxtCache = {
        domain,
        robotsTxt: '',
        rules: [],
        lastFetched: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // Shorter cache for errors
        isValid: false,
        fetchError: errorMessage
      };
      this.robotsCache.set(domain, errorCache);
      return [];
    }
  }

  /**
   * Parse robots.txt content into structured rules
   */
  private parseRobotsTxt(robotsTxt: string): RobotsTxtRule[] {
    const lines = robotsTxt.split('\n').map(line => line.trim());
    const rules: RobotsTxtRule[] = [];
    let currentRule: Partial<RobotsTxtRule> | null = null;

    for (const line of lines) {
      if (line.startsWith('#') || line === '') {
        continue; // Skip comments and empty lines
      }

      const [directive, ...valueParts] = line.split(':');
      const value = valueParts.join(':').trim();

      switch (directive.toLowerCase()) {
        case 'user-agent':
          // Start new rule
          if (currentRule) {
            rules.push(this.finalizeRule(currentRule));
          }
          currentRule = {
            userAgent: value,
            disallowedPaths: [],
            allowedPaths: [],
            sitemapUrls: []
          };
          break;

        case 'disallow':
          if (currentRule && value) {
            currentRule.disallowedPaths!.push(value);
          }
          break;

        case 'allow':
          if (currentRule && value) {
            currentRule.allowedPaths!.push(value);
          }
          break;

        case 'crawl-delay':
          if (currentRule && value) {
            currentRule.crawlDelay = parseInt(value, 10);
          }
          break;

        case 'sitemap':
          if (currentRule && value) {
            currentRule.sitemapUrls!.push(value);
          }
          break;
      }
    }

    // Add the last rule
    if (currentRule) {
      rules.push(this.finalizeRule(currentRule));
    }

    return rules;
  }

  private finalizeRule(rule: Partial<RobotsTxtRule>): RobotsTxtRule {
    const finalRule: RobotsTxtRule = {
      userAgent: rule.userAgent || '*',
      disallowedPaths: rule.disallowedPaths || [],
      allowedPaths: rule.allowedPaths || [],
      sitemapUrls: rule.sitemapUrls || []
    };

    if (rule.crawlDelay !== undefined) {
      finalRule.crawlDelay = rule.crawlDelay;
    }

    return finalRule;
  }

  /**
   * Find applicable robots.txt rules for a user agent
   */
  private findApplicableRules(rules: RobotsTxtRule[], userAgent: string): RobotsTxtRule[] {
    const specificRules = rules.filter(rule =>
      rule.userAgent.toLowerCase() === userAgent.toLowerCase()
    );

    if (specificRules.length > 0) {
      return specificRules;
    }

    // Fall back to wildcard rules
    return rules.filter(rule => rule.userAgent === '*');
  }

  /**
   * Check if a path is allowed based on robots.txt rules
   */
  private checkPathAllowed(path: string, rules: RobotsTxtRule[]): boolean {
    for (const rule of rules) {
      // Check explicit allows first (they take precedence)
      for (const allowedPath of rule.allowedPaths) {
        if (this.pathMatches(path, allowedPath)) {
          return true;
        }
      }

      // Check disallows
      for (const disallowedPath of rule.disallowedPaths) {
        if (this.pathMatches(path, disallowedPath)) {
          return false;
        }
      }
    }

    // If no rules match, default to allowed
    return true;
  }

  /**
   * Check if a path matches a robots.txt pattern
   */
  private pathMatches(path: string, pattern: string): boolean {
    if (pattern === '/') {
      return true; // Disallow all
    }

    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return path.startsWith(prefix);
    }

    return path.startsWith(pattern);
  }

  /**
   * Create legal metadata for scraped data
   * Requirement 3.2: Include legal metadata (domain, source type, jurisdiction)
   */
  createLegalMetadata(
    domain: string,
    sourceType: 'municipal' | 'news' | 'government' | 'commercial',
    jurisdiction: string = 'DE'
  ): LegalMetadata {
    return {
      domain,
      sourceType,
      jurisdiction,
      robotsTxtCompliant: false, // Will be set by compliance check
      gdprCompliant: jurisdiction === 'DE' || jurisdiction === 'EU',
      dataProcessingBasis: sourceType === 'government' || sourceType === 'municipal'
        ? 'public_task'
        : 'legitimate_interest',
      retentionPeriod: this.getRetentionPeriod(sourceType, jurisdiction),
      anonymizationApplied: false, // Will be set after anonymization
      collectedAt: new Date(),
      lastUpdated: new Date()
    };
  }

  private getRetentionPeriod(sourceType: string, _jurisdiction: string): number {
    // Default retention periods in days
    const retentionPeriods: Record<string, number> = {
      municipal: 2555, // 7 years for government data
      government: 2555, // 7 years for government data
      news: 1095, // 3 years for news data
      commercial: 730 // 2 years for commercial data
    };

    return retentionPeriods[sourceType] || 365;
  }

  /**
   * Anonymize extracted data for GDPR compliance
   * Requirement 3.3: Implement GDPR-compliant anonymization and logging
   */
  anonymizeExtractedData(data: ExtractedItem[]): ExtractedItem[] {
    return data.map(item => this.anonymizeItem(item));
  }

  private anonymizeItem(item: ExtractedItem): ExtractedItem {
    const anonymized = { ...item };

    if (this.anonymizationConfig.anonymizeEmails && item.email) {
      anonymized.email = this.anonymizeEmail(item.email);
    }

    if (this.anonymizationConfig.anonymizePhones && item.phone) {
      anonymized.phone = this.anonymizePhone(item.phone);
    }

    if (this.anonymizationConfig.anonymizeAddresses && item.address) {
      anonymized.address = this.anonymizeAddress(item.address);
    }

    return anonymized;
  }

  private anonymizeEmail(email: string): string {
    if (!this.anonymizationConfig.preserveFormat) {
      return this.hashValue(email);
    }

    const [localPart, domain] = email.split('@');
    const hashedLocal = this.hashValue(localPart).substring(0, 8);
    return `${hashedLocal}@${domain}`;
  }

  private anonymizePhone(phone: string): string {
    if (!this.anonymizationConfig.preserveFormat) {
      return this.hashValue(phone);
    }

    // Keep format but replace digits
    const digits = phone.replace(/\D/g, '');
    const hashedDigits = this.hashValue(digits).replace(/\D/g, '').substring(0, digits.length);
    return phone.replace(/\d/g, (match, index) => {
      const digitIndex = phone.substring(0, index).replace(/\D/g, '').length;
      return hashedDigits[digitIndex] || match;
    });
  }

  private anonymizeAddress(address: string): string {
    // Simple anonymization - replace house numbers and specific street names
    return address
      .replace(/\d+/g, 'XXX') // Replace numbers
      .replace(/\b\w+straße\b/gi, 'Musterstraße') // Replace German street names
      .replace(/\b\w+str\.\b/gi, 'Musterstr.'); // Replace abbreviated street names
  }

  private hashValue(value: string): string {
    return crypto
      .createHash('sha256')
      .update(value + this.anonymizationConfig.hashSalt)
      .digest('hex');
  }

  /**
   * Process data deletion request for GDPR compliance
   * Requirement 3.4: Support data removal from storage
   */
  async processDeletionRequest(request: DataDeletionRequest): Promise<DataDeletionRequest> {
    const updatedRequest: DataDeletionRequest = { ...request, status: 'processing' };

    try {
      let deletedRecords = 0;
      const errors: string[] = [];

      // This would integrate with the actual database repositories
      // For now, we'll simulate the deletion logic

      if (request.domain) {
        // Delete all data for a specific domain
        deletedRecords += await this.deleteDataByDomain(request.domain);
      }

      if (request.email) {
        // Delete data containing specific email
        deletedRecords += await this.deleteDataByEmail(request.email);
      }

      if (request.phoneNumber) {
        // Delete data containing specific phone number
        deletedRecords += await this.deleteDataByPhone(request.phoneNumber);
      }

      if (request.dateRange) {
        // Delete data within date range
        deletedRecords += await this.deleteDataByDateRange(request.dateRange.start, request.dateRange.end);
      }

      updatedRequest.status = 'completed';
      updatedRequest.processedAt = new Date();
      updatedRequest.deletedRecords = deletedRecords;
      if (errors.length > 0) {
        updatedRequest.errors = errors;
      }

      logger.info('GDPR deletion request processed', {
        requestId: request.requestId,
        deletedRecords,
        errors: errors.length
      });

      return updatedRequest;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error processing GDPR deletion request', {
        requestId: request.requestId,
        error: errorMessage
      });

      updatedRequest.status = 'failed';
      updatedRequest.processedAt = new Date();
      updatedRequest.errors = [errorMessage];
      return updatedRequest;
    }
  }

  // Placeholder methods for database integration
  private async deleteDataByDomain(domain: string): Promise<number> {
    // This would integrate with ExtractedDataRepository
    logger.info('Deleting data by domain', { domain });
    return 0; // Placeholder
  }

  private async deleteDataByEmail(email: string): Promise<number> {
    // This would integrate with ExtractedDataRepository
    logger.info('Deleting data by email', { email: this.hashValue(email) });
    return 0; // Placeholder
  }

  private async deleteDataByPhone(phone: string): Promise<number> {
    // This would integrate with ExtractedDataRepository
    logger.info('Deleting data by phone', { phone: this.hashValue(phone) });
    return 0; // Placeholder
  }

  private async deleteDataByDateRange(start: Date, end: Date): Promise<number> {
    // This would integrate with ExtractedDataRepository
    logger.info('Deleting data by date range', { start, end });
    return 0; // Placeholder
  }

  /**
   * Perform comprehensive compliance check for a domain
   */
  async performComplianceCheck(domain: string, sourceType: 'municipal' | 'news' | 'government' | 'commercial'): Promise<ComplianceCheckResult> {
    const result: ComplianceCheckResult = {
      domain,
      robotsTxtCompliant: false,
      gdprApplicable: true, // Assume GDPR applies for EU domains
      recommendedActions: [],
      warnings: [],
      lastChecked: new Date()
    };

    try {
      // Check robots.txt compliance
      const robotsRules = await this.getRobotsTxtRules(domain);
      result.robotsTxtCompliant = true;
      result.robotsTxtUrl = `https://${domain}/robots.txt`;
      result.robotsTxtRules = robotsRules;

      if (robotsRules.length === 0) {
        result.warnings.push('No robots.txt file found - proceeding with caution');
      }

      // Check for overly restrictive robots.txt
      const hasRestrictiveRules = robotsRules.some(rule =>
        rule.disallowedPaths.includes('/') ||
        rule.disallowedPaths.length > 10
      );

      if (hasRestrictiveRules) {
        result.warnings.push('Domain has restrictive robots.txt rules');
        result.recommendedActions.push('Review robots.txt compliance before scraping');
      }

      // GDPR recommendations
      if (result.gdprApplicable) {
        result.recommendedActions.push('Apply GDPR anonymization to extracted data');
        result.recommendedActions.push('Set appropriate data retention period');
        result.recommendedActions.push('Log data processing activities');
      }

      // Source type specific recommendations
      if (sourceType === 'government' || sourceType === 'municipal') {
        result.recommendedActions.push('Use public_task as legal basis for processing');
        result.recommendedActions.push('Set extended retention period for government data');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.warnings.push(`Compliance check failed: ${errorMessage}`);
      result.recommendedActions.push('Manual compliance review required');
    }

    return result;
  }

  /**
   * Get crawl delay for a domain from robots.txt
   */
  async getCrawlDelay(domain: string, userAgent: string = this.userAgent): Promise<number> {
    const rules = await this.getRobotsTxtRules(domain);
    const applicableRules = this.findApplicableRules(rules, userAgent);

    for (const rule of applicableRules) {
      if (rule.crawlDelay !== undefined) {
        return rule.crawlDelay * 1000; // Convert to milliseconds
      }
    }

    return 1000; // Default 1 second delay
  }

  /**
   * Clear robots.txt cache for a domain
   */
  clearRobotsCache(domain?: string): void {
    if (domain) {
      this.robotsCache.delete(domain);
    } else {
      this.robotsCache.clear();
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { totalEntries: number; validEntries: number; expiredEntries: number } {
    const now = new Date();
    let validEntries = 0;
    let expiredEntries = 0;

    for (const cache of this.robotsCache.values()) {
      if (cache.expiresAt > now && cache.isValid) {
        validEntries++;
      } else {
        expiredEntries++;
      }
    }

    return {
      totalEntries: this.robotsCache.size,
      validEntries,
      expiredEntries
    };
  }
}