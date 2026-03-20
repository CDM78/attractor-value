import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/shared/Layout'
import ScreenerTable from './components/Screener/ScreenerTable'
import WatchlistTable from './components/Watchlist/WatchlistTable'
import PortfolioDashboard from './components/Portfolio/PortfolioDashboard'
import AnalysisDetail from './components/Analysis/AnalysisDetail'
import TransactionHistory from './components/Transactions/TransactionHistory'
import HowItWorks from './components/HowItWorks/HowItWorks'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/screener" replace />} />
          <Route path="screener" element={<ScreenerTable />} />
          <Route path="watchlist" element={<WatchlistTable />} />
          <Route path="portfolio" element={<PortfolioDashboard />} />
          <Route path="analyze/:ticker" element={<AnalysisDetail />} />
          <Route path="transactions" element={<TransactionHistory />} />
          <Route path="how-it-works" element={<HowItWorks />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
