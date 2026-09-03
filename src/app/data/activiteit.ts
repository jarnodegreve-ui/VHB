import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { ActivityLogEntry, User, View } from '../../types';
import { apiFetch } from '../../lib/api';

/**
 * Activiteit (admin): het logboek en de inlog-activiteit. Heeft de kern
 * niet nodig (geen vangrails, geen revisies) en wordt daarom als eerste
 * opgebouwd — `fetchActivityLog` gaat via de kern naar alle savers, die na
 * een geslaagde opslag het logboek van een admin verversen.
 */
export function useActiviteitData({ session, currentUser, currentView }: {
  session: Session | null;
  currentUser: User | null;
  currentView: View;
}) {
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [loginActivity, setLoginActivity] = useState<ActivityLogEntry[]>([]);

  const fetchActivityLog = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/activity', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setActivityLog(data);
      }
    } catch (error) {
      console.error('Error fetching activity log:', error);
    }
  };

  const fetchLoginActivity = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/activity/logins', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data.logins)) {
        setLoginActivity(data.logins);
      }
    } catch (error) {
      console.error('Error fetching login activity:', error);
    }
  };

  useEffect(() => {
    if (currentView === 'activiteit' && currentUser?.role === 'admin') {
      fetchActivityLog();
      fetchLoginActivity();
    }
  }, [currentView, currentUser?.role]);

  /** Bij uitloggen: het logboek leeg (loginActivity blijft, zoals voorheen). */
  const resetActiviteit = () => {
    setActivityLog([]);
  };

  return { activityLog, loginActivity, fetchActivityLog, fetchLoginActivity, resetActiviteit };
}
