import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import RealtimeDashboard from './pages/RealtimeDashboard';
import StrategyEngine from './pages/StrategyEngine';
import Strategy from './pages/Strategy';
import Discovery from './pages/Discovery';
import Leaderboard from './pages/Leaderboard';
import Backtest from './pages/Backtest';
import NewsCrawler from './pages/NewsCrawler';
import Settings from './pages/Settings';
import Search from './pages/Search';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Navigate to="/realtime" replace />} />
          <Route path="/realtime" element={<RealtimeDashboard />} />
          <Route path="/strategy-engine" element={<StrategyEngine />} />
          <Route path="/strategy" element={<Strategy />} />
          <Route path="/strategy/:strategyId" element={<Strategy />} />
          <Route path="/search" element={<Navigate to="/strategy" replace />} />
          <Route path="/search/:searchRunId" element={<Search />} />
          <Route path="/discovery" element={<Discovery />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/backtest" element={<Backtest />} />
          <Route path="/news-crawler" element={<NewsCrawler />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/realtime" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
