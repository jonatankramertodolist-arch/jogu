import { useEffect } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';

import ImportPrompt from './components/ImportPrompt';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import { initAuth, useAuth } from './lib/auth';
import { checkFirstSignIn, useOnboarding } from './lib/onboarding';
import { startSync } from './lib/sync';
import CoachPage from './pages/CoachPage';
import GoalPage from './pages/GoalPage';
import HistoryPage from './pages/HistoryPage';
import LoginPage from './pages/LoginPage';
import SchedulePage from './pages/SchedulePage';
import SettingsPage from './pages/SettingsPage';
import TodayPage from './pages/TodayPage';

/**
 * HashRouter keeps deep links working on any static host without server-side
 * rewrite rules, which matters because the site should be shareable as a plain
 * link that anyone can host or bookmark.
 */
export default function App() {
  const auth = useAuth();
  const onboarding = useOnboarding();

  useEffect(() => {
    void initAuth();
  }, []);

  useEffect(() => {
    if (auth.status === 'signed-in') void checkFirstSignIn();
  }, [auth.status]);

  // Held back until the athlete has said what happens to any training already in
  // this browser, so syncing cannot answer that question for them.
  useEffect(() => {
    if (auth.status === 'signed-in' && onboarding.settled) startSync();
  }, [auth.status, onboarding.settled]);

  if (auth.status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner label="Startar…" />
      </div>
    );
  }

  // Sign-in is a door, not a wall: someone who has chosen to train without an
  // account, or who is offline, still gets straight to their session.
  if (auth.status === 'anonymous' && !auth.localMode) {
    return <LoginPage />;
  }

  if (onboarding.question) return <ImportPrompt />;

  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<TodayPage />} />
          <Route path="/schema" element={<SchedulePage />} />
          <Route path="/historik" element={<HistoryPage />} />
          <Route path="/coach" element={<CoachPage />} />
          <Route path="/mal" element={<GoalPage />} />
          <Route path="/installningar" element={<SettingsPage />} />
          <Route path="*" element={<TodayPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
