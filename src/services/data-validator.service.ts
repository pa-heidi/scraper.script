/**
 * Data Validator Service
 * Implements data normalization and validation for ExtractedItem
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

import { ExtractedItem } from "../interfaces/core";

export interface ValidationResult {
    isValid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
    qualityScore: number;
    normalizedItem: ExtractedItem | undefined;
}

export interface ValidationError {
    field: string;
    message: string;
    severity: "error" | "warning";
}

export interface ValidationWarning {
    field: string;
    message: string;
    suggestion?: string;
}

export interface DataQualityMetrics {
    completeness: number;
    accuracy: number;
    consistency: number;
    overall: number;
}

export class DataValidatorService {
    private readonly requiredFields = ["title", "description", "language"];

    /**
     * Validates and normalizes an ExtractedItem
     */
    public validateAndNormalize(
        item: Partial<ExtractedItem>,
        baseUrl?: string
    ): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: ValidationWarning[] = [];

        // Create a copy for normalization
        const normalizedItem = { ...item } as ExtractedItem;

        // Validate required fields
        this.validateRequiredFields(normalizedItem, errors);

        // Normalize fields
        this.normalizeTitle(normalizedItem, warnings);
        this.normalizeDescription(normalizedItem, warnings);
        this.normalizeDates(normalizedItem, errors, warnings);
        this.normalizeImages(normalizedItem, baseUrl, warnings);
        this.normalizeLanguage(normalizedItem, errors, warnings);
        this.normalizeEmail(normalizedItem, warnings);
        this.normalizePhone(normalizedItem, warnings);
        this.normalizeWebsite(normalizedItem, warnings);
        this.normalizeCoordinates(normalizedItem, warnings);
        this.normalizePrices(normalizedItem, warnings);
        this.normalizeZipcode(normalizedItem, warnings);

        // Calculate quality score
        const qualityScore = this.calculateQualityScore(normalizedItem);

        const isValid =
            errors.filter((e) => e.severity === "error").length === 0;

        return {
            isValid,
            errors,
            warnings,
            qualityScore,
            normalizedItem: isValid ? normalizedItem : undefined
        };
    }

    private validateRequiredFields(
        item: Partial<ExtractedItem>,
        errors: ValidationError[]
    ): void {
        for (const field of this.requiredFields) {
            const value = item[field as keyof ExtractedItem];
            if (
                !value ||
                (typeof value === "string" && value.trim().length === 0)
            ) {
                errors.push({
                    field,
                    message: `Required field '${field}' is missing or empty`,
                    severity: "error"
                });
            }
        }
    }

    private normalizeTitle(
        item: ExtractedItem,
        warnings: ValidationWarning[]
    ): void {
        if (item.title) {
            item.title = item.title.trim();

            if (item.title.length > 500) {
                warnings.push({
                    field: "title",
                    message: "Title is very long (>500 characters)",
                    suggestion:
                        "Consider truncating or reviewing extraction logic"
                });
            }

            if (item.title.length < 3) {
                warnings.push({
                    field: "title",
                    message: "Title is very short (<3 characters)",
                    suggestion: "Verify extraction captured complete title"
                });
            }
        }
    }

    private normalizeDescription(
        item: ExtractedItem,
        warnings: ValidationWarning[]
    ): void {
        if (item.description) {
            item.description = item.description.trim();

            if (item.description.length > 5000) {
                warnings.push({
                    field: "description",
                    message: "Description is very long (>5000 characters)",
                    suggestion:
                        "Consider truncating or reviewing extraction logic"
                });
            }
        }
    }

    /**
     * Normalizes dates to ISO 8601 format
     * Requirements: 5.3 - normalize dates to ISO 8601 format
     */
    private normalizeDates(
        item: ExtractedItem,
        errors: ValidationError[],
        warnings: ValidationWarning[]
    ): void {
        // Normalize single dates
        if (item.startDate) {
            const normalized = this.normalizeDate(
                item.startDate,
                "startDate",
                errors,
                warnings
            );
            if (normalized) {
                item.startDate = normalized;
            } else {
                delete (item as any).startDate;
            }
        }

        if (item.endDate) {
            const normalized = this.normalizeDate(
                item.endDate,
                "endDate",
                errors,
                warnings
            );
            if (normalized) {
                item.endDate = normalized;
            } else {
                delete (item as any).endDate;
            }
        }

        if (item.createdAt) {
            const normalized = this.normalizeDate(
                item.createdAt,
                "createdAt",
                errors,
                warnings
            );
            if (normalized) {
                item.createdAt = normalized;
            } else {
                delete (item as any).createdAt;
            }
        }

        // Normalize dates array
        if (item.dates && Array.isArray(item.dates)) {
            item.dates = item.dates
                .map((date) =>
                    this.normalizeDate(date, "dates", errors, warnings)
                )
                .filter((date) => date !== null) as string[];
        } else {
            item.dates = [];
        }

        // Validate date logic
        if (item.startDate && item.endDate) {
            const start = new Date(item.startDate);
            const end = new Date(item.endDate);
            if (start > end) {
                warnings.push({
                    field: "dates",
                    message: "Start date is after end date",
                    suggestion: "Verify date extraction logic"
                });
            }
        }
    }

    private normalizeDate(
        dateStr: string,
        fieldName: string,
        errors: ValidationError[],
        warnings: ValidationWarning[]
    ): string | null {
        if (!dateStr || typeof dateStr !== "string") {
            return null;
        }

        const trimmed = dateStr.trim();
        if (!trimmed) {
            return null;
        }

        try {
            // Try parsing as-is first
            let date = new Date(trimmed);

            // If invalid, try common German date formats
            if (isNaN(date.getTime())) {
                date = this.parseGermanDate(trimmed);
            }

            // If still invalid, try other common formats
            if (isNaN(date.getTime())) {
                date = this.parseCommonDateFormats(trimmed);
            }

            if (isNaN(date.getTime())) {
                errors.push({
                    field: fieldName,
                    message: `Invalid date format: "${trimmed}"`,
                    severity: "error"
                });
                return null;
            }

            // Validate reasonable date range
            const now = new Date();
            const yearsDiff = Math.abs(now.getFullYear() - date.getFullYear());
            if (yearsDiff > 100) {
                warnings.push({
                    field: fieldName,
                    message: `Date seems unrealistic: ${date.toISOString()}`,
                    suggestion: "Verify date extraction and parsing"
                });
            }

            return date.toISOString();
        } catch (error) {
            errors.push({
                field: fieldName,
                message: `Failed to parse date: "${trimmed}"`,
                severity: "error"
            });
            return null;
        }
    }

    private parseGermanDate(dateStr: string): Date {
        // Common German formats: DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY
        const germanPatterns = [
            /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/,
            /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
            /^(\d{1,2})-(\d{1,2})-(\d{4})$/
        ];

        for (const pattern of germanPatterns) {
            const match = dateStr.match(pattern);
            if (match) {
                const [, day, month, year] = match;
                return new Date(
                    parseInt(year),
                    parseInt(month) - 1,
                    parseInt(day)
                );
            }
        }

        return new Date(NaN);
    }

    private parseCommonDateFormats(dateStr: string): Date {
        // Try ISO-like formats, US formats, etc.
        const patterns = [
            /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
            /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
            /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/
        ];

        for (const pattern of patterns) {
            const match = dateStr.match(pattern);
            if (match) {
                const [, first, second, third] = match;
                // Assume YYYY-MM-DD or YYYY/MM/DD format
                if (first.length === 4) {
                    return new Date(
                        parseInt(first),
                        parseInt(second) - 1,
                        parseInt(third)
                    );
                }
                // Assume MM/DD/YYYY format
                return new Date(
                    parseInt(third),
                    parseInt(first) - 1,
                    parseInt(second)
                );
            }
        }

        return new Date(NaN);
    }

    /**
     * Normalizes image URLs from relative to absolute
     * Requirements: 5.4 - convert relative URLs to absolute URLs
     */
    private normalizeImages(
        item: ExtractedItem,
        baseUrl: string | undefined,
        warnings: ValidationWarning[]
    ): void {
        if (!item.images || !Array.isArray(item.images)) {
            item.images = [];
            return;
        }

        const normalizedImages: string[] = [];

        for (const imageUrl of item.images) {
            if (!imageUrl || typeof imageUrl !== "string") {
                continue;
            }

            const trimmed = imageUrl.trim();
            if (!trimmed) {
                continue;
            }

            try {
                let absoluteUrl: string;

                // Check if already absolute URL
                if (this.isAbsoluteUrl(trimmed)) {
                    absoluteUrl = trimmed;
                } else if (baseUrl) {
                    // Convert relative to absolute
                    absoluteUrl = new URL(trimmed, baseUrl).href;
                } else {
                    warnings.push({
                        field: "images",
                        message: `Cannot convert relative URL to absolute: "${trimmed}" (no base URL provided)`,
                        suggestion:
                            "Provide base URL for proper image URL resolution"
                    });
                    continue;
                }

                // Validate URL format
                new URL(absoluteUrl); // This will throw if invalid
                normalizedImages.push(absoluteUrl);
            } catch (error) {
                warnings.push({
                    field: "images",
                    message: `Invalid image URL: "${trimmed}"`,
                    suggestion: "Verify image URL extraction logic"
                });
            }
        }

        item.images = normalizedImages;
    }

    private isAbsoluteUrl(url: string): boolean {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Detects and normalizes language
     * Requirements: 5.2 - detect and tag language (German/English)
     */
    private normalizeLanguage(
        item: ExtractedItem,
        errors: ValidationError[],
        warnings: ValidationWarning[]
    ): void {
        if (!item.language) {
            // Attempt language detection based on content
            const detectedLanguage = this.detectLanguage(
                item.title,
                item.description
            );
            if (detectedLanguage) {
                item.language = detectedLanguage;
                warnings.push({
                    field: "language",
                    message: `Language auto-detected as '${detectedLanguage}'`,
                    suggestion: "Verify language detection accuracy"
                });
            } else {
                errors.push({
                    field: "language",
                    message:
                        "Language not specified and could not be auto-detected",
                    severity: "error"
                });
            }
        } else if (item.language !== "de" && item.language !== "en") {
            errors.push({
                field: "language",
                message: `Invalid language code: '${item.language}'. Must be 'de' or 'en'`,
                severity: "error"
            });
        }
    }

    private detectLanguage(
        title?: string,
        description?: string
    ): "de" | "en" | null {
        const text = `${title || ""} ${description || ""}`.toLowerCase();

        if (!text.trim()) {
            return null;
        }

        // German indicators
        const germanWords = [
            "der",
            "die",
            "das",
            "und",
            "ist",
            "mit",
            "für",
            "von",
            "auf",
            "zu",
            "im",
            "am",
            "über",
            "nach",
            "bei",
            "durch"
        ];
        const germanChars = /[äöüß]/;

        // English indicators
        const englishWords = [
            "the",
            "and",
            "is",
            "with",
            "for",
            "from",
            "on",
            "to",
            "in",
            "at",
            "over",
            "after",
            "by",
            "through"
        ];

        let germanScore = 0;
        let englishScore = 0;

        // Check for characteristic words
        for (const word of germanWords) {
            if (text.includes(word)) germanScore++;
        }

        for (const word of englishWords) {
            if (text.includes(word)) englishScore++;
        }

        // Check for German special characters
        if (germanChars.test(text)) {
            germanScore += 3; // Strong indicator
        }

        // Return language with higher score, or null if tie/no indicators
        if (germanScore > englishScore) {
            return "de";
        } else if (englishScore > germanScore) {
            return "en";
        }

        return null;
    }

    private normalizeEmail(
        item: ExtractedItem,
        warnings: ValidationWarning[]
    ): void {
        if (item.email) {
            item.email = item.email.trim().toLowerCase();

            // Basic email validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(item.email)) {
                warnings.push({
                    field: "email",
                    message: `Invalid email format: "${item.email}"`,
                    suggestion: "Verify email extraction logic"
                });
            }
        }
    }

    private normalizePhone(
        item: ExtractedItem,
        warnings: ValidationWarning[]
    ): void {
        if (item.phone) {
            // Remove common formatting characters
            const cleaned = item.phone.replace(/[\s\-\(\)\+]/g, "");

            // Basic phone number validation (digits only, reasonable length)
            if (!/^\d{7,15}$/.test(cleaned)) {
                warnings.push({
                    field: "phone",
                    message: `Phone number format may be invalid: "${item.phone}"`,
                    suggestion: "Verify phone number extraction and formatting"
                });
            } else {
                item.phone = cleaned;
            }
        }
    }

    private normalizeWebsite(
        item: ExtractedItem,
        warnings: ValidationWarning[]
    ): void {
        if (item.website) {
            let url = item.website.trim();

            // Add protocol if missing
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                url = "https://" + url;
            }

            try {
                const parsedUrl = new URL(url);
                item.website = parsedUrl.href;
            } catch (error) {
                warnings.push({
                    field: "website",
                    message: `Invalid website URL: "${item.website}"`,
                    suggestion: "Verify website URL extraction logic"
                });
            }
        }
    }

    private normalizeCoordinates(
        item: ExtractedItem,
        warnings: ValidationWarning[]
    ): void {
        if (item.longitude !== undefined) {
            if (
                typeof item.longitude !== "number" ||
                item.longitude < -180 ||
                item.longitude > 180
            ) {
                warnings.push({
                    field: "longitude",
                    message: `Invalid longitude value: ${item.longitude}`,
                    suggestion: "Longitude must be between -180 and 180"
                });
            }
        }

        if (item.latitude !== undefined) {
            if (
                typeof item.latitude !== "number" ||
                item.latitude < -90 ||
                item.latitude > 90
            ) {
                warnings.push({
                    field: "latitude",
                    message: `Invalid latitude value: ${item.latitude}`,
                    suggestion: "Latitude must be between -90 and 90"
                });
            }
        }
    }

    private normalizePrices(
        item: ExtractedItem,
        warnings: ValidationWarning[]
    ): void {
        if (item.price !== undefined) {
            if (typeof item.price !== "number" || item.price < 0) {
                warnings.push({
                    field: "price",
                    message: `Invalid price value: ${item.price}`,
                    suggestion: "Price must be a non-negative number"
                });
            }
        }

        if (item.discountPrice !== undefined) {
            if (
                typeof item.discountPrice !== "number" ||
                item.discountPrice < 0
            ) {
                warnings.push({
                    field: "discountPrice",
                    message: `Invalid discount price value: ${item.discountPrice}`,
                    suggestion: "Discount price must be a non-negative number"
                });
            }

            // Check if discount price is higher than regular price
            if (item.price !== undefined && item.discountPrice > item.price) {
                warnings.push({
                    field: "discountPrice",
                    message: "Discount price is higher than regular price",
                    suggestion: "Verify price extraction logic"
                });
            }
        }
    }

    private normalizeZipcode(
        item: ExtractedItem,
        warnings: ValidationWarning[]
    ): void {
        if (item.zipcode !== undefined) {
            if (
                typeof item.zipcode !== "number" ||
                item.zipcode < 0 ||
                item.zipcode > 99999
            ) {
                warnings.push({
                    field: "zipcode",
                    message: `Invalid zipcode value: ${item.zipcode}`,
                    suggestion: "Zipcode must be a number between 0 and 99999"
                });
            }
        }
    }

    /**
     * Calculates data quality score based on completeness and accuracy
     * Requirements: 5.5 - data quality scoring based on completeness and accuracy
     */
    private calculateQualityScore(item: ExtractedItem): number {
        const metrics = this.calculateQualityMetrics(item);
        return metrics.overall;
    }

    /**
     * Calculates detailed quality metrics
     */
    public calculateQualityMetrics(item: ExtractedItem): DataQualityMetrics {
        const completeness = this.calculateCompleteness(item);
        const accuracy = this.calculateAccuracy(item);
        const consistency = this.calculateConsistency(item);

        // Weighted average: completeness 40%, accuracy 40%, consistency 20%
        const overall = completeness * 0.4 + accuracy * 0.4 + consistency * 0.2;

        return {
            completeness,
            accuracy,
            consistency,
            overall: Math.round(overall * 100) / 100 // Round to 2 decimal places
        };
    }

    private calculateCompleteness(item: ExtractedItem): number {
        const allFields = [
            "title",
            "description",
            "language",
            "place",
            "address",
            "email",
            "phone",
            "website",
            "price",
            "discountPrice",
            "longitude",
            "latitude",
            "startDate",
            "endDate",
            "dates",
            "createdAt",
            "zipcode",
            "images"
        ];
        let filledFields = 0;
        let totalWeight = 0;

        for (const field of allFields) {
            const value = item[field as keyof ExtractedItem];
            const isRequired = this.requiredFields.includes(field);
            const weight = isRequired ? 2 : 1; // Required fields have double weight

            totalWeight += weight;

            if (this.isFieldFilled(value)) {
                filledFields += weight;
            }
        }

        return totalWeight > 0 ? filledFields / totalWeight : 0;
    }

    private isFieldFilled(value: any): boolean {
        if (value === null || value === undefined) {
            return false;
        }

        if (typeof value === "string") {
            return value.trim().length > 0;
        }

        if (Array.isArray(value)) {
            return value.length > 0;
        }

        if (typeof value === "number") {
            return !isNaN(value);
        }

        return true;
    }

    private calculateAccuracy(item: ExtractedItem): number {
        let totalChecks = 0;
        let passedChecks = 0;

        // Check date formats
        if (item.startDate) {
            totalChecks++;
            if (this.isValidISODate(item.startDate)) passedChecks++;
        }

        if (item.endDate) {
            totalChecks++;
            if (this.isValidISODate(item.endDate)) passedChecks++;
        }

        if (item.createdAt) {
            totalChecks++;
            if (this.isValidISODate(item.createdAt)) passedChecks++;
        }

        // Check email format
        if (item.email) {
            totalChecks++;
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (emailRegex.test(item.email)) passedChecks++;
        }

        // Check URL formats
        if (item.website) {
            totalChecks++;
            try {
                new URL(item.website);
                passedChecks++;
            } catch {}
        }

        // Check coordinates
        if (item.longitude !== undefined) {
            totalChecks++;
            if (
                typeof item.longitude === "number" &&
                item.longitude >= -180 &&
                item.longitude <= 180
            ) {
                passedChecks++;
            }
        }

        if (item.latitude !== undefined) {
            totalChecks++;
            if (
                typeof item.latitude === "number" &&
                item.latitude >= -90 &&
                item.latitude <= 90
            ) {
                passedChecks++;
            }
        }

        // Check image URLs
        if (item.images && item.images.length > 0) {
            for (const imageUrl of item.images) {
                totalChecks++;
                try {
                    new URL(imageUrl);
                    passedChecks++;
                } catch {}
            }
        }

        return totalChecks > 0 ? passedChecks / totalChecks : 1;
    }

    private calculateConsistency(item: ExtractedItem): number {
        let totalChecks = 0;
        let passedChecks = 0;

        // Check date consistency
        if (item.startDate && item.endDate) {
            totalChecks++;
            const start = new Date(item.startDate);
            const end = new Date(item.endDate);
            if (start <= end) passedChecks++;
        }

        // Check price consistency
        if (item.price !== undefined && item.discountPrice !== undefined) {
            totalChecks++;
            if (item.discountPrice <= item.price) passedChecks++;
        }

        // Check coordinate consistency (both or neither)
        const hasLongitude = item.longitude !== undefined;
        const hasLatitude = item.latitude !== undefined;
        if (hasLongitude || hasLatitude) {
            totalChecks++;
            if (hasLongitude && hasLatitude) passedChecks++;
        }

        return totalChecks > 0 ? passedChecks / totalChecks : 1;
    }

    private isValidISODate(dateStr: string): boolean {
        try {
            const date = new Date(dateStr);
            return !isNaN(date.getTime()) && dateStr === date.toISOString();
        } catch {
            return false;
        }
    }

    /**
     * Validates multiple items and returns batch results
     */
    public validateBatch(
        items: Partial<ExtractedItem>[],
        baseUrl?: string
    ): ValidationResult[] {
        return items.map((item) => this.validateAndNormalize(item, baseUrl));
    }

    /**
     * Gets validation statistics for a batch of results
     */
    public getBatchStatistics(results: ValidationResult[]): {
        totalItems: number;
        validItems: number;
        invalidItems: number;
        averageQualityScore: number;
        commonErrors: { message: string; count: number }[];
        commonWarnings: { message: string; count: number }[];
    } {
        const totalItems = results.length;
        const validItems = results.filter((r) => r.isValid).length;
        const invalidItems = totalItems - validItems;

        const qualityScores = results.map((r) => r.qualityScore);
        const averageQualityScore =
            qualityScores.reduce((sum, score) => sum + score, 0) / totalItems;

        // Count error frequencies
        const errorCounts = new Map<string, number>();
        const warningCounts = new Map<string, number>();

        for (const result of results) {
            for (const error of result.errors) {
                errorCounts.set(
                    error.message,
                    (errorCounts.get(error.message) || 0) + 1
                );
            }
            for (const warning of result.warnings) {
                warningCounts.set(
                    warning.message,
                    (warningCounts.get(warning.message) || 0) + 1
                );
            }
        }

        const commonErrors = Array.from(errorCounts.entries())
            .map(([message, count]) => ({ message, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        const commonWarnings = Array.from(warningCounts.entries())
            .map(([message, count]) => ({ message, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        return {
            totalItems,
            validItems,
            invalidItems,
            averageQualityScore: Math.round(averageQualityScore * 100) / 100,
            commonErrors,
            commonWarnings
        };
    }
}
