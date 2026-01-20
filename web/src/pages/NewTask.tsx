import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Play, Loader2, Globe, Settings, Plus, X, Info } from 'lucide-react';
import { tasksApi, plansApi, PlanSummary } from '../services/api';

type TaskType = 'generate' | 'execute';

export default function NewTask() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [taskType, setTaskType] = useState<TaskType>(
    (searchParams.get('type') as TaskType) || 'generate'
  );
  const [url, setUrl] = useState('');
  const [planId, setPlanId] = useState(searchParams.get('planId') || '');
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingPlans, setLoadingPlans] = useState(false);

  // Generate options
  const [contentUrls, setContentUrls] = useState<string[]>([]);
  const [newContentUrl, setNewContentUrl] = useState('');
  const [useLocalModel, setUseLocalModel] = useState(false);
  const [priority, setPriority] = useState<'cost' | 'speed' | 'accuracy' | 'balanced'>('balanced');
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState<number | undefined>(undefined);
  const [maxCost, setMaxCost] = useState<number | undefined>(undefined);
  const [isPaginated, setIsPaginated] = useState(false);
  const [paginationUrl, setPaginationUrl] = useState('');
  const [saveLlmTracking, setSaveLlmTracking] = useState(true);
  const [detailedReport, setDetailedReport] = useState(true);

  // Execute options
  const [maxPages, setMaxPages] = useState(5);
  const [maxItems, setMaxItems] = useState(50);
  const [maxItemsPerPage, setMaxItemsPerPage] = useState<number | undefined>(undefined);
  const [timeout, setTimeout] = useState(30000);
  const [testMode, setTestMode] = useState(false);
  const [retryFailedItems, setRetryFailedItems] = useState(true);
  const [validateResults, setValidateResults] = useState(true);

  useEffect(() => {
    if (taskType === 'execute') {
      loadPlans();
    }
  }, [taskType]);

  async function loadPlans() {
    try {
      setLoadingPlans(true);
      const data = await plansApi.list();
      setPlans(data);
    } catch (err) {
      console.error('Failed to load plans:', err);
    } finally {
      setLoadingPlans(false);
    }
  }

  function addContentUrl() {
    if (newContentUrl && !contentUrls.includes(newContentUrl)) {
      try {
        new URL(newContentUrl);
        setContentUrls([...contentUrls, newContentUrl]);
        setNewContentUrl('');
      } catch {
        setError('Invalid URL format');
      }
    }
  }

  function removeContentUrl(url: string) {
    setContentUrls(contentUrls.filter((u) => u !== url));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      let task;

      if (taskType === 'generate') {
        if (!url) {
          throw new Error('URL is required');
        }
        task = await tasksApi.generate({
          url,
          contentUrls: contentUrls.length > 0 ? contentUrls : undefined,
          options: {
            useLocalModel,
            priority,
            confidenceThreshold,
            maxTokens,
            maxCost,
            isPaginated,
            paginationUrl: paginationUrl || undefined,
            saveLlmTracking,
            detailedReport,
          },
        });
      } else {
        if (!planId) {
          throw new Error('Plan ID is required');
        }
        task = await tasksApi.execute({
          planId,
          options: {
            maxPages,
            maxItems,
            maxItemsPerPage,
            timeout,
            testMode,
            retryFailedItems,
            validateResults,
          },
        });
      }

      navigate(`/tasks/${task.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start task');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">New Scraping Task</h1>

      {/* Task Type Selection */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Task Type</h2>
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => setTaskType('generate')}
            className={`flex-1 p-4 border-2 rounded-lg transition-colors ${
              taskType === 'generate'
                ? 'border-primary-600 bg-primary-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <Globe
              className={`mx-auto mb-2 ${
                taskType === 'generate' ? 'text-primary-600' : 'text-gray-400'
              }`}
              size={32}
            />
            <p className="font-medium">Generate Plan</p>
            <p className="text-sm text-gray-500">Analyze a website and create a scraping plan</p>
          </button>

          <button
            type="button"
            onClick={() => setTaskType('execute')}
            className={`flex-1 p-4 border-2 rounded-lg transition-colors ${
              taskType === 'execute'
                ? 'border-primary-600 bg-primary-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <Play
              className={`mx-auto mb-2 ${
                taskType === 'execute' ? 'text-primary-600' : 'text-gray-400'
              }`}
              size={32}
            />
            <p className="font-medium">Execute Plan</p>
            <p className="text-sm text-gray-500">Run an existing scraping plan</p>
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Generate Form */}
        {taskType === 'generate' && (
          <>
            {/* Website Details */}
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <h2 className="text-lg font-semibold mb-4">Website Details</h2>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Website URL *
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/events"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  Main page URL containing the list of items to scrape
                </p>
              </div>

              {/* Content URLs */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Sample Content URLs (Optional)
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Provide example detail page URLs to help the AI understand the content structure
                </p>
                <div className="flex gap-2 mb-2">
                  <input
                    type="url"
                    value={newContentUrl}
                    onChange={(e) => setNewContentUrl(e.target.value)}
                    placeholder="https://example.com/events/123"
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addContentUrl();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={addContentUrl}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    <Plus size={20} />
                  </button>
                </div>
                {contentUrls.length > 0 && (
                  <div className="space-y-2">
                    {contentUrls.map((contentUrl) => (
                      <div
                        key={contentUrl}
                        className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-lg"
                      >
                        <span className="flex-1 text-sm truncate">{contentUrl}</span>
                        <button
                          type="button"
                          onClick={() => removeContentUrl(contentUrl)}
                          className="text-gray-400 hover:text-red-500"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* AI Configuration */}
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
                <Settings size={20} />
                AI Configuration
              </h2>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as typeof priority)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="balanced">Balanced (Default)</option>
                    <option value="cost">Cost (Cheapest)</option>
                    <option value="speed">Speed (Fastest)</option>
                    <option value="accuracy">Accuracy (Most Precise)</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Optimize for cost, speed, or accuracy
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Confidence Threshold
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={confidenceThreshold}
                      onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
                      className="flex-1"
                    />
                    <span className="text-sm font-medium w-12 text-right">
                      {(confidenceThreshold * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Minimum confidence required for plan acceptance
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Max Tokens (Optional)
                  </label>
                  <input
                    type="number"
                    min="100"
                    max="128000"
                    value={maxTokens || ''}
                    onChange={(e) =>
                      setMaxTokens(e.target.value ? parseInt(e.target.value) : undefined)
                    }
                    placeholder="Auto"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Maximum tokens for LLM response</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Max Cost USD (Optional)
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    max="100"
                    step="0.01"
                    value={maxCost || ''}
                    onChange={(e) =>
                      setMaxCost(e.target.value ? parseFloat(e.target.value) : undefined)
                    }
                    placeholder="No limit"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Maximum cost per request</p>
                </div>
              </div>

              <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                <input
                  type="checkbox"
                  id="useLocalModel"
                  checked={useLocalModel}
                  onChange={(e) => setUseLocalModel(e.target.checked)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <label htmlFor="useLocalModel" className="text-sm text-gray-700">
                  Use local AI model (Ollama)
                </label>
                <span title="Requires Ollama running locally">
                  <Info size={14} className="text-gray-400 ml-auto" />
                </span>
              </div>
            </div>

            {/* Pagination Options */}
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <h2 className="text-lg font-semibold mb-4">Pagination</h2>

              <div className="flex items-center gap-2 mb-4">
                <input
                  type="checkbox"
                  id="isPaginated"
                  checked={isPaginated}
                  onChange={(e) => setIsPaginated(e.target.checked)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <label htmlFor="isPaginated" className="text-sm font-medium text-gray-700">
                  Website has pagination
                </label>
              </div>

              {isPaginated && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Example Pagination URL (Optional)
                  </label>
                  <input
                    type="url"
                    value={paginationUrl}
                    onChange={(e) => setPaginationUrl(e.target.value)}
                    placeholder="https://example.com/events?page=2"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Helps the AI understand the pagination pattern
                  </p>
                </div>
              )}
            </div>

            {/* Report Options */}
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <h2 className="text-lg font-semibold mb-4">Report Options</h2>

              <div className="space-y-3">
                <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                  <input
                    type="checkbox"
                    id="detailedReport"
                    checked={detailedReport}
                    onChange={(e) => setDetailedReport(e.target.checked)}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <label htmlFor="detailedReport" className="text-sm text-gray-700 flex-1">
                    Detailed Report
                  </label>
                  <span className="text-xs text-gray-500">
                    Includes test results, cookie consent, metadata
                  </span>
                </div>

                <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                  <input
                    type="checkbox"
                    id="saveLlmTracking"
                    checked={saveLlmTracking}
                    onChange={(e) => setSaveLlmTracking(e.target.checked)}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <label htmlFor="saveLlmTracking" className="text-sm text-gray-700 flex-1">
                    Save LLM Tracking Data
                  </label>
                  <span className="text-xs text-gray-500">
                    Records AI model usage, tokens, and costs
                  </span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Execute Form */}
        {taskType === 'execute' && (
          <>
            {/* Plan Selection */}
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <h2 className="text-lg font-semibold mb-4">Select Plan</h2>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Plan *</label>
                {loadingPlans ? (
                  <div className="flex items-center gap-2 text-gray-500">
                    <Loader2 className="animate-spin" size={20} />
                    Loading plans...
                  </div>
                ) : (
                  <select
                    value={planId}
                    onChange={(e) => setPlanId(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    required
                  >
                    <option value="">Select a plan...</option>
                    {plans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.domain} - {(plan.confidence * 100).toFixed(0)}% confidence
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* Execution Limits */}
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
                <Settings size={20} />
                Execution Limits
              </h2>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max Pages</label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={maxPages}
                    onChange={(e) => setMaxPages(parseInt(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Maximum number of pages to process
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Max Items Total
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10000"
                    value={maxItems}
                    onChange={(e) => setMaxItems(parseInt(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Maximum items to extract in total</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Max Items Per Page (Optional)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={maxItemsPerPage || ''}
                    onChange={(e) =>
                      setMaxItemsPerPage(e.target.value ? parseInt(e.target.value) : undefined)
                    }
                    placeholder="All items"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Limit items extracted per page</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Timeout (ms)
                  </label>
                  <input
                    type="number"
                    min="5000"
                    max="300000"
                    step="1000"
                    value={timeout}
                    onChange={(e) => setTimeout(parseInt(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Page load timeout ({(timeout / 1000).toFixed(0)}s)
                  </p>
                </div>
              </div>
            </div>

            {/* Execution Options */}
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <h2 className="text-lg font-semibold mb-4">Options</h2>

              <div className="space-y-3">
                <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                  <input
                    type="checkbox"
                    id="testMode"
                    checked={testMode}
                    onChange={(e) => setTestMode(e.target.checked)}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <label htmlFor="testMode" className="text-sm text-gray-700 flex-1">
                    Test Mode
                  </label>
                  <span className="text-xs text-gray-500">
                    Limited extraction for testing
                  </span>
                </div>

                <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                  <input
                    type="checkbox"
                    id="validateResults"
                    checked={validateResults}
                    onChange={(e) => setValidateResults(e.target.checked)}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <label htmlFor="validateResults" className="text-sm text-gray-700 flex-1">
                    Validate Results
                  </label>
                  <span className="text-xs text-gray-500">
                    Run data validation on extracted items
                  </span>
                </div>

                <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                  <input
                    type="checkbox"
                    id="retryFailedItems"
                    checked={retryFailedItems}
                    onChange={(e) => setRetryFailedItems(e.target.checked)}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <label htmlFor="retryFailedItems" className="text-sm text-gray-700 flex-1">
                    Retry Failed Items
                  </label>
                  <span className="text-xs text-gray-500">
                    Automatically retry failed extractions
                  </span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <Loader2 className="animate-spin" size={20} />
              Starting Task...
            </>
          ) : (
            <>
              <Play size={20} />
              Start {taskType === 'generate' ? 'Plan Generation' : 'Execution'}
            </>
          )}
        </button>
      </form>
    </div>
  );
}
