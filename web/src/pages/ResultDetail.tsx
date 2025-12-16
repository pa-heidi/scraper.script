import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Loader2, Download, CheckCircle, XCircle } from 'lucide-react';
import { resultsApi, ResultDetail as ResultDetailType } from '../services/api';

export default function ResultDetail() {
  const { id } = useParams<{ id: string }>();
  const [result, setResult] = useState<ResultDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    async function loadResult() {
      if (!id) return;
      try {
        setLoading(true);
        const data = await resultsApi.get(id);
        setResult(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load result');
      } finally {
        setLoading(false);
      }
    }
    loadResult();
  }, [id]);

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="p-8">
        <Link to="/results" className="flex items-center gap-2 text-primary-600 mb-4">
          <ArrowLeft size={20} />
          Back to Results
        </Link>
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg">
          {error || 'Result not found'}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <Link to="/results" className="flex items-center gap-2 text-primary-600 mb-4">
        <ArrowLeft size={20} />
        Back to Results
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold font-mono">{result.runId}</h1>
          <p className="text-gray-500">Plan: {result.planId}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {showRaw ? 'Show Table' : 'Show JSON'}
          </button>
          <a
            href={`/api/results/${encodeURIComponent(id || '')}`}
            download={`${result.runId}.json`}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Download size={20} />
            Download
          </a>
        </div>
      </div>

      {/* Result Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Status</p>
          <div className="flex items-center gap-2 mt-1">
            {result.status === 'completed' ? (
              <>
                <CheckCircle className="text-green-500" size={20} />
                <span className="font-medium text-green-600">Completed</span>
              </>
            ) : (
              <>
                <XCircle className="text-red-500" size={20} />
                <span className="font-medium text-red-600">Failed</span>
              </>
            )}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Items Extracted</p>
          <p className="text-xl font-bold text-primary-600">{result.metrics.itemsExtracted}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Pages Processed</p>
          <p className="text-xl font-bold">{result.metrics.pagesProcessed}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Duration</p>
          <p className="text-xl font-bold">{formatDuration(result.metrics.duration)}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Accuracy</p>
          <p className="text-xl font-bold">
            {(result.metrics.accuracyScore * 100).toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Errors */}
      {result.errors && result.errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <h3 className="font-medium text-red-800 mb-2">Errors</h3>
          <ul className="list-disc list-inside text-red-700 text-sm">
            {result.errors.map((error, idx) => (
              <li key={idx}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Extracted Data */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold">
            Extracted Data ({result.extractedData.length} items)
          </h2>
        </div>

        {showRaw ? (
          <div className="p-4">
            <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-auto max-h-[600px] text-sm">
              {JSON.stringify(result.extractedData, null, 2)}
            </pre>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">#</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Title</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Description</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Source URL</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.extractedData.map((item, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-500">{idx + 1}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-sm">{item.title || 'N/A'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-600 line-clamp-2 max-w-md">
                        {item.description || 'N/A'}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {item.sourceUrl ? (
                        <a
                          href={item.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary-600 hover:underline truncate block max-w-xs"
                        >
                          {item.sourceUrl}
                        </a>
                      ) : (
                        <span className="text-sm text-gray-400">N/A</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
