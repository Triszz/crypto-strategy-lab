import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import RealtimeDashboard from './pages/RealtimeDashboard';
import StrategyEngine from './pages/StrategyEngine';
import Discovery from './pages/Discovery';
import Backtest from './pages/Backtest';
import NewsCrawler from './pages/NewsCrawler';
import Settings from './pages/Settings';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Navigate to="/realtime" replace />} />
          <Route path="/realtime" element={<RealtimeDashboard />} />
          <Route path="/strategy-engine" element={<StrategyEngine />} />
          <Route path="/discovery" element={<Discovery />} />
          <Route path="/backtest" element={<Backtest />} />
          <Route path="/news-crawler" element={<NewsCrawler />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/realtime" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
