import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/shared/Layout'
import ScreenerTable from './components/Screener/ScreenerTable'
import WatchlistTable from './components/Watchlist/WatchlistTable'
import PortfolioDashboard from './components/Portfolio/PortfolioDashboard'
import AnalysisDetail from './components/Analysis/AnalysisDetail'

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
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
