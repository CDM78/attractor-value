import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/shared/Layout'
import Dashboard from './components/Dashboard/Dashboard'
import CandidatesPage from './components/Candidates/CandidatesPage'
import HoldingsPage from './components/Holdings/HoldingsPage'
import AnalysisDetail from './components/Analysis/AnalysisDetail'
import TransactionHistory from './components/Transactions/TransactionHistory'
import HowItWorks from './components/HowItWorks/HowItWorks'
import AdminPage from './components/Admin/AdminPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="candidates" element={<CandidatesPage />} />
          <Route path="holdings" element={<HoldingsPage />} />
          <Route path="analyze/:ticker" element={<AnalysisDetail />} />
          <Route path="transactions" element={<TransactionHistory />} />
          <Route path="how-it-works" element={<HowItWorks />} />
          <Route path="admin" element={<AdminPage />} />
          {/* Redirects from old routes */}
          <Route path="screener" element={<Navigate to="/dashboard" replace />} />
          <Route path="watchlist" element={<Navigate to="/candidates" replace />} />
          <Route path="portfolio" element={<Navigate to="/holdings" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
