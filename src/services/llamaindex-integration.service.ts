import { Document, VectorStoreIndex, SimpleDirectoryReader, StorageContext } from 'llamaindex';
import { logger } from '../utils/logger';

export interface LlamaIndexConfig {
  enabled: boolean;
  storagePath?: string;
  chunkSize?: number;
  chunkOverlap?: number;
}

export interface DocumentMetadata {
  type: string;
  timestamp: string;
  originalSize?: number;
  compressedSize?: number;
  compressionRatio?: number;
  chunksAnalyzed?: number;
  [key: string]: any;
}

export class LlamaIndexIntegrationService {
  private index?: VectorStoreIndex;
  private documents: Document[] = [];
  private config: LlamaIndexConfig;

  constructor(config: LlamaIndexConfig = { enabled: true }) {
    this.config = {
      storagePath: config.storagePath || './storage/llamaindex',
      chunkSize: config.chunkSize || 1000,
      chunkOverlap: config.chunkOverlap || 200,
      ...config
    };
  }

  /**
   * Initialize LlamaIndex with compressed HTML content
   */
  async initializeIndex(compressedHtml: string, metadata: Partial<DocumentMetadata> = {}): Promise<void> {
    if (!this.config.enabled) {
      logger.info('LlamaIndex integration disabled, skipping initialization');
      return;
    }

    try {
      // Create document from compressed HTML
      const document = new Document({
        text: compressedHtml,
        metadata: {
          ...metadata,
          type: 'compressed-html',
          timestamp: new Date().toISOString()
        }
      });

      this.documents = [document];

      // Create index
      this.index = await VectorStoreIndex.fromDocuments(this.documents);

      logger.info('LlamaIndex initialized with compressed HTML', {
        documentCount: this.documents.length,
        textLength: compressedHtml.length,
        metadata: Object.keys(metadata)
      });

    } catch (error) {
      logger.error('Failed to initialize LlamaIndex', { error });
      throw error;
    }
  }

  /**
   * Query the index for relevant content
   */
  async queryRelevantContent(query: string, topK: number = 5): Promise<string[]> {
    if (!this.index) {
      logger.warn('LlamaIndex not initialized, returning empty results');
      return [];
    }

    try {
      const queryEngine = this.index.asQueryEngine();
      const response = await queryEngine.query({ query });

      // Extract relevant content from response
      const relevantContent = response.sourceNodes?.map(node => (node as any).text || '') || [];

      logger.debug('LlamaIndex query completed', {
        query,
        resultsCount: relevantContent.length,
        topK
      });

      return relevantContent.slice(0, topK);

    } catch (error) {
      logger.error('Failed to query LlamaIndex', { error });
      return [];
    }
  }

  /**
   * Get document summary
   */
  async getDocumentSummary(): Promise<string> {
    if (!this.index) {
      logger.warn('LlamaIndex not initialized, returning default summary');
      return 'Summary not available - LlamaIndex not initialized';
    }

    try {
      // Use query engine to get summary instead of summary engine
      const queryEngine = this.index.asQueryEngine();
      const response = await queryEngine.query({ query: 'Provide a summary of this document' });
      const summary = response.response || 'No summary available';

      logger.debug('Document summary generated', {
        summaryLength: summary.length
      });

      return summary;

    } catch (error) {
      logger.error('Failed to get document summary', { error });
      return 'Summary generation failed';
    }
  }

  /**
   * Find similar content sections
   */
  async findSimilarContent(content: string, threshold: number = 0.7): Promise<Array<{
    content: string;
    similarity: number;
    metadata: any;
  }>> {
    if (!this.index) {
      return [];
    }

    try {
      const retriever = this.index.asRetriever();
      const nodes = await retriever.retrieve(content);

      const similarContent = nodes
        .filter(node => (node.score || 0) >= threshold)
        .map(node => ({
          content: (node as any).text || '',
          similarity: node.score || 0,
          metadata: (node as any).metadata || {}
        }));

      logger.debug('Similar content search completed', {
        queryLength: content.length,
        resultsCount: similarContent.length,
        threshold
      });

      return similarContent;

    } catch (error) {
      logger.error('Failed to find similar content', { error });
      return [];
    }
  }

  /**
   * Get compression insights
   */
  async getCompressionInsights(): Promise<{
    contentTypes: string[];
    keyTopics: string[];
    compressionEffectiveness: number;
    recommendations: string[];
  }> {
    if (!this.index) {
      return {
        contentTypes: [],
        keyTopics: [],
        compressionEffectiveness: 0,
        recommendations: []
      };
    }

    try {
      // Query for content type analysis
      const contentTypes = await this.queryRelevantContent('What types of content are present?', 3);

      // Query for key topics
      const keyTopics = await this.queryRelevantContent('What are the main topics and subjects?', 5);

      // Get document summary for analysis
      const summary = await this.getDocumentSummary();

      // Calculate compression effectiveness based on content density
      const compressionEffectiveness = this.calculateCompressionEffectiveness(summary);

      // Generate recommendations
      const recommendations = this.generateRecommendations(contentTypes, keyTopics, compressionEffectiveness);

      return {
        contentTypes,
        keyTopics,
        compressionEffectiveness,
        recommendations
      };

    } catch (error) {
      logger.error('Failed to get compression insights', { error });
      return {
        contentTypes: [],
        keyTopics: [],
        compressionEffectiveness: 0,
        recommendations: ['Analysis failed - check logs for details']
      };
    }
  }

  /**
   * Calculate compression effectiveness
   */
  private calculateCompressionEffectiveness(summary: string): number {
    // Simple heuristic: longer, more detailed summaries indicate better compression
    const words = summary.split(' ').length;
    const sentences = summary.split(/[.!?]+/).length;

    // Normalize to 0-1 scale
    const effectiveness = Math.min(words / 100, 1) * Math.min(sentences / 10, 1);
    return Math.round(effectiveness * 100) / 100;
  }

  /**
   * Generate recommendations based on analysis
   */
  private generateRecommendations(
    contentTypes: string[],
    keyTopics: string[],
    effectiveness: number
  ): string[] {
    const recommendations: string[] = [];

    if (effectiveness < 0.5) {
      recommendations.push('Consider more aggressive content filtering');
    }

    if (contentTypes.some(type => type.toLowerCase().includes('navigation'))) {
      recommendations.push('Navigation elements detected - consider removing for better compression');
    }

    if (keyTopics.length > 10) {
      recommendations.push('High topic diversity - consider focusing on main content areas');
    }

    if (effectiveness > 0.8) {
      recommendations.push('Excellent compression achieved - current settings are optimal');
    }

    return recommendations.length > 0 ? recommendations : ['No specific recommendations at this time'];
  }

  /**
   * Check if service is available
   */
  isAvailable(): boolean {
    return this.config.enabled && this.index !== undefined;
  }

  /**
   * Get service statistics
   */
  getStats(): {
    enabled: boolean;
    initialized: boolean;
    documentCount: number;
    config: LlamaIndexConfig;
  } {
    return {
      enabled: this.config.enabled,
      initialized: this.index !== undefined,
      documentCount: this.documents.length,
      config: this.config
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    try {
      // LlamaIndex doesn't require explicit cleanup in this implementation
      this.index = undefined;
      this.documents = [];

      logger.info('LlamaIndex service cleaned up');
    } catch (error) {
      logger.error('Error during LlamaIndex cleanup', { error });
    }
  }
}
