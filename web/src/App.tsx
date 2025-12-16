import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { Home, FileText, Play, Database, Settings } from 'lucide-react'
import Dashboard from './pages/Dashboard'
import Plans from './pages/Plans'
import PlanDetail from './pages/PlanDetail'
import Results from './pages/Results'
import ResultDetail from './pages/ResultDetail'
import NewTask from './pages/NewTask'
import TaskDetail from './pages/TaskDetail'

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen flex">
        {/* Sidebar */}
        <aside className="w-64 bg-gray-900 text-white flex flex-col sticky top-0 h-screen">
          <div className="p-4 border-b border-gray-800">
            <h1 className="text-xl font-bold flex items-center gap-2">
              <span className="text-2xl">🕷️</span>
              AI Scraper
            </h1>
          </div>

          <nav className="flex-1 p-4">
            <ul className="space-y-2">
              <li>
                <NavLink
                  to="/"
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                      isActive ? 'bg-primary-600 text-white' : 'text-gray-300 hover:bg-gray-800'
                    }`
                  }
                >
                  <Home size={20} />
                  Dashboard
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/plans"
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                      isActive ? 'bg-primary-600 text-white' : 'text-gray-300 hover:bg-gray-800'
                    }`
                  }
                >
                  <FileText size={20} />
                  Plans
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/results"
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                      isActive ? 'bg-primary-600 text-white' : 'text-gray-300 hover:bg-gray-800'
                    }`
                  }
                >
                  <Database size={20} />
                  Results
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/new-task"
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                      isActive ? 'bg-primary-600 text-white' : 'text-gray-300 hover:bg-gray-800'
                    }`
                  }
                >
                  <Play size={20} />
                  New Task
                </NavLink>
              </li>
            </ul>
          </nav>

          <div className="p-4 border-t border-gray-800 text-sm text-gray-500">
            <div className="flex items-center gap-2">
              <Settings size={16} />
              v1.0.0
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/plans" element={<Plans />} />
            <Route path="/plans/:id" element={<PlanDetail />} />
            <Route path="/results" element={<Results />} />
            <Route path="/results/:id" element={<ResultDetail />} />
            <Route path="/new-task" element={<NewTask />} />
            <Route path="/tasks/:id" element={<TaskDetail />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
