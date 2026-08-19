import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import RealtimePage from './pages/RealtimePage';
import StrategyPage from './pages/StrategyPage';
import BacktestPage from './pages/BacktestPage';
import LeaderboardPage from './pages/LeaderboardPage';
import NewsPage from './pages/NewsPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Navigate to="/realtime" replace />} />
          <Route path="/realtime" element={<RealtimePage />} />
          <Route path="/strategy" element={<StrategyPage />} />
          <Route path="/backtest" element={<BacktestPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/news" element={<NewsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/realtime" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
