import { useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Loader2, CheckCircle, XCircle, RefreshCw, StopCircle, Play, FileText } from 'lucide-react';
import { useSSE } from '../hooks/useSSE';
import { tasksApi } from '../services/api';

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const { task, logs, isConnected, error, reconnect } = useSSE(id || null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to bottom of logs
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  async function handleCancel() {
    if (!id) return;
    try {
      await tasksApi.cancel(id);
    } catch (err) {
      console.error('Failed to cancel task:', err);
    }
  }

  if (!task && !error) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  if (error && !task) {
    return (
      <div className="p-8">
        <Link to="/" className="flex items-center gap-2 text-primary-600 mb-4">
          <ArrowLeft size={20} />
          Back to Dashboard
        </Link>
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg">
          {error}
        </div>
      </div>
    );
  }

  const isRunning = task?.status === 'running' || task?.status === 'pending';

  return (
    <div className="p-8">
      <Link to="/" className="flex items-center gap-2 text-primary-600 mb-4">
        <ArrowLeft size={20} />
        Back to Dashboard
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">
            {task?.type === 'generate' ? 'Plan Generation' : 'Plan Execution'}
          </h1>
          <p className="text-gray-500 font-mono text-sm">{task?.id}</p>
        </div>
        <div className="flex items-center gap-3">
          {!isConnected && isRunning && (
            <button
              onClick={reconnect}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <RefreshCw size={20} />
              Reconnect
            </button>
          )}
          {isRunning && (
            <button
              onClick={handleCancel}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              <StopCircle size={20} />
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Status */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Status</p>
          <div className="flex items-center gap-2 mt-1">
            {task?.status === 'completed' && (
              <>
                <CheckCircle className="text-green-500" size={20} />
                <span className="font-medium text-green-600">Completed</span>
              </>
            )}
            {task?.status === 'failed' && (
              <>
                <XCircle className="text-red-500" size={20} />
                <span className="font-medium text-red-600">Failed</span>
              </>
            )}
            {task?.status === 'running' && (
              <>
                <Loader2 className="animate-spin text-primary-600" size={20} />
                <span className="font-medium text-primary-600">Running</span>
              </>
            )}
            {task?.status === 'pending' && (
              <>
                <Loader2 className="text-gray-400" size={20} />
                <span className="font-medium text-gray-600">Pending</span>
              </>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Progress</p>
          <div className="mt-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-gray-200 rounded-full h-2">
                <div
                  className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${task?.progress || 0}%` }}
                />
              </div>
              <span className="text-sm font-medium">{task?.progress || 0}%</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Started</p>
          <p className="text-sm mt-1">
            {task?.startedAt ? new Date(task.startedAt).toLocaleString() : 'N/A'}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Connection</p>
          <div className="flex items-center gap-2 mt-1">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-400'}`} />
            <span className="text-sm">{isConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
        </div>
      </div>

      {/* Input */}
      <div className="bg-white rounded-lg shadow mb-6">
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold">Input</h2>
        </div>
        <div className="p-4 space-y-2">
          {task?.input.url && (
            <p className="text-sm">
              <span className="text-gray-500">URL:</span>{' '}
              <a href={task.input.url} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">
                {task.input.url}
              </a>
            </p>
          )}
          {task?.input.contentUrls && task.input.contentUrls.length > 0 && (
            <div className="text-sm">
              <span className="text-gray-500">Sample Content URLs:</span>
              <ul className="mt-1 ml-4 list-disc space-y-1">
                {task.input.contentUrls.map((contentUrl, idx) => (
                  <li key={idx}>
                    <a href={contentUrl} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">
                      {contentUrl}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {task?.input.planId && (
            <p className="text-sm">
              <span className="text-gray-500">Plan ID:</span>{' '}
              <Link to={`/plans/${encodeURIComponent(task.input.planId)}`} className="font-mono text-primary-600 hover:underline">
                {task.input.planId}
              </Link>
            </p>
          )}
          {task?.input.options && (
            <details className="mt-2">
              <summary className="text-sm text-gray-500 cursor-pointer">Options</summary>
              <pre className="mt-2 text-xs bg-gray-100 p-2 rounded overflow-auto">
                {JSON.stringify(task.input.options, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </div>

      {/* Output */}
      {task?.output && (
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="p-4 border-b flex items-center justify-between">
            <h2 className="text-lg font-semibold">Output</h2>
            {/* Action buttons for completed generate tasks */}
            {task.type === 'generate' && task.status === 'completed' && task.output.planId && (
              <div className="flex items-center gap-2">
                <Link
                  to={`/plans/${encodeURIComponent(task.output.planId)}`}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <FileText size={16} />
                  View Plan
                </Link>
                <Link
                  to={`/new-task?type=execute&planId=${encodeURIComponent(task.output.planId)}`}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                >
                  <Play size={16} />
                  Execute Plan
                </Link>
              </div>
            )}
            {/* Action button for completed execute tasks */}
            {task.type === 'execute' && task.status === 'completed' && task.output.resultFile && (
              <div className="flex items-center gap-2">
                {task.input.planId && (
                  <Link
                    to={`/plans/${encodeURIComponent(task.input.planId)}`}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <FileText size={16} />
                    View Plan
                  </Link>
                )}
              </div>
            )}
          </div>
          <div className="p-4">
            {task.output.planId && (
              <p className="text-sm mb-2">
                <span className="text-gray-500">Plan ID:</span>{' '}
                <Link to={`/plans/${encodeURIComponent(task.output.planId)}`} className="text-primary-600 hover:underline font-mono">
                  {task.output.planId}
                </Link>
              </p>
            )}
            {task.output.planFile && (
              <p className="text-sm mb-2">
                <span className="text-gray-500">Plan File:</span>{' '}
                <span className="font-mono text-sm">{task.output.planFile}</span>
              </p>
            )}
            {task.output.resultFile && (
              <p className="text-sm mb-2">
                <span className="text-gray-500">Result File:</span>{' '}
                <span className="font-mono text-sm">{task.output.resultFile}</span>
              </p>
            )}
            {task.output.itemsExtracted !== undefined && (
              <p className="text-sm mb-2">
                <span className="text-gray-500">Items Extracted:</span>{' '}
                <span className="font-medium">{task.output.itemsExtracted}</span>
              </p>
            )}
            {task.output.pagesProcessed !== undefined && (
              <p className="text-sm">
                <span className="text-gray-500">Pages Processed:</span>{' '}
                <span className="font-medium">{task.output.pagesProcessed}</span>
              </p>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {task?.error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <h3 className="font-medium text-red-800 mb-2">Error</h3>
          <p className="text-red-700 text-sm">{task.error}</p>
        </div>
      )}

      {/* Logs */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold">Logs ({logs.length})</h2>
        </div>
        <div className="p-4 bg-gray-900 rounded-b-lg max-h-96 overflow-auto font-mono text-sm">
          {logs.length === 0 ? (
            <p className="text-gray-500">No logs yet...</p>
          ) : (
            logs.map((log, idx) => (
              <div
                key={idx}
                className={`py-0.5 ${
                  log.includes('[stderr]') ? 'text-red-400' : 'text-gray-300'
                }`}
              >
                {log}
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
}
