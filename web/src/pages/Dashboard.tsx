import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Database, Play, Clock, CheckCircle, XCircle, Loader2, Trash2, StopCircle } from 'lucide-react';
import { plansApi, resultsApi, tasksApi, PlanSummary, ResultSummary, TaskState } from '../services/api';

export default function Dashboard() {
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [results, setResults] = useState<ResultSummary[]>([]);
  const [tasks, setTasks] = useState<TaskState[]>([]);
  const [totalPlans, setTotalPlans] = useState(0);
  const [totalResults, setTotalResults] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    try {
      setLoading(true);
      const [plansData, resultsData, tasksData] = await Promise.all([
        plansApi.list(),
        resultsApi.list(),
        tasksApi.list(),
      ]);
      setTotalPlans(plansData.length);
      setTotalResults(resultsData.length);
      setPlans(plansData.slice(0, 5));
      setResults(resultsData.slice(0, 5));
      setTasks(tasksData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleCancelTask(e: React.MouseEvent, taskId: string) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await tasksApi.cancel(taskId);
      await loadData();
    } catch (err) {
      console.error('Failed to cancel task:', err);
    }
  }

  async function handleDeleteTask(e: React.MouseEvent, taskId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this task?')) return;
    try {
      await tasksApi.delete(taskId);
      await loadData();
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-primary-100 rounded-lg">
              <FileText className="text-primary-600" size={24} />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Plans</p>
              <p className="text-2xl font-bold">{totalPlans}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-100 rounded-lg">
              <Database className="text-green-600" size={24} />
            </div>
            <div>
              <p className="text-sm text-gray-500">Execution Results</p>
              <p className="text-2xl font-bold">{totalResults}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-yellow-100 rounded-lg">
              <Play className="text-yellow-600" size={24} />
            </div>
            <div>
              <p className="text-sm text-gray-500">Active Tasks</p>
              <p className="text-2xl font-bold">{tasks.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tasks */}
      {tasks.length > 0 && (
        <div className="bg-white rounded-lg shadow mb-8">
          <div className="p-4 border-b flex items-center justify-between">
            <h2 className="text-lg font-semibold">Tasks ({tasks.length})</h2>
            <span className="text-sm text-gray-500">
              {tasks.filter(t => t.status === 'running' || t.status === 'pending').length} active
            </span>
          </div>
          <div className="divide-y max-h-96 overflow-auto">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
              >
                <Link
                  to={`/tasks/${task.id}`}
                  className="flex items-center gap-3 flex-1 min-w-0"
                >
                  {task.status === 'running' && (
                    <Loader2 className="animate-spin text-primary-600 flex-shrink-0" size={20} />
                  )}
                  {task.status === 'pending' && (
                    <Clock className="text-gray-400 flex-shrink-0" size={20} />
                  )}
                  {task.status === 'completed' && (
                    <CheckCircle className="text-green-500 flex-shrink-0" size={20} />
                  )}
                  {task.status === 'failed' && (
                    <XCircle className="text-red-500 flex-shrink-0" size={20} />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium">
                      {task.type === 'generate' ? 'Generate Plan' : 'Execute Plan'}
                    </p>
                    <p className="text-sm text-gray-500 truncate">
                      {task.input.url || task.input.planId}
                    </p>
                  </div>
                </Link>
                <div className="flex items-center gap-3 ml-4">
                  {(task.status === 'running' || task.status === 'pending') && (
                    <>
                      <div className="w-24 bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-primary-600 h-2 rounded-full transition-all"
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>
                      <span className="text-sm text-gray-500 w-10">{task.progress}%</span>
                      <button
                        onClick={(e) => handleCancelTask(e, task.id)}
                        className="p-1.5 text-orange-500 hover:bg-orange-50 rounded transition-colors"
                        title="Cancel task"
                      >
                        <StopCircle size={18} />
                      </button>
                    </>
                  )}
                  <button
                    onClick={(e) => handleDeleteTask(e, task.id)}
                    className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors"
                    title="Delete task"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Plans */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent Plans</h2>
            <Link to="/plans" className="text-sm text-primary-600 hover:underline">
              View all
            </Link>
          </div>
          <div className="divide-y">
            {plans.length === 0 ? (
              <p className="p-4 text-gray-500 text-center">No plans yet</p>
            ) : (
              plans.map((plan) => (
                <Link
                  key={plan.id}
                  to={`/plans/${encodeURIComponent(plan.filename)}`}
                  className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
                >
                  <div>
                    <p className="font-medium">{plan.domain}</p>
                    <p className="text-sm text-gray-500">{plan.createdAt}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">
                      {(plan.confidence * 100).toFixed(0)}%
                    </span>
                    <CheckCircle className="text-green-500" size={16} />
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Recent Results */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent Results</h2>
            <Link to="/results" className="text-sm text-primary-600 hover:underline">
              View all
            </Link>
          </div>
          <div className="divide-y">
            {results.length === 0 ? (
              <p className="p-4 text-gray-500 text-center">No results yet</p>
            ) : (
              results.map((result) => (
                <Link
                  key={result.id}
                  to={`/results/${encodeURIComponent(result.filename)}`}
                  className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
                >
                  <div>
                    <p className="font-medium">{result.id}</p>
                    <p className="text-sm text-gray-500">
                      {result.itemsExtracted} items extracted
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {result.status === 'completed' ? (
                      <CheckCircle className="text-green-500" size={16} />
                    ) : (
                      <XCircle className="text-red-500" size={16} />
                    )}
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
        <div className="flex gap-4">
          <Link
            to="/new-task"
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            <Play size={20} />
            New Scraping Task
          </Link>
        </div>
      </div>
    </div>
  );
}
