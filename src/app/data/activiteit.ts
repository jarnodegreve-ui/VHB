import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { ActivityLogEntry, User, View } from '../../types';
import type { AanwezigheidSessie } from '../../lib/aanwezigheid';
import { apiFetch } from '../../lib/api';
import { useCollectieState } from './kern';

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
  const [activityLog, setActivityLog, zetLogUitAntwoord] = useCollectieState<ActivityLogEntry[]>([]);
  // Uitgesteld (admin laadt het log ná de poort): waar zodra de eerste
  // laadpoging rond is; tot dan houden lezers hun skelet aan.
  const [activityLogGeladen, setActivityLogGeladen] = useState(false);
  const [loginActivity, , zetLoginsUitAntwoord] = useCollectieState<ActivityLogEntry[]>([]);
  const [aanwezigheid, setAanwezigheid, zetAanwezigheidUitAntwoord] = useCollectieState<AanwezigheidSessie[]>([]);
  /** Naam van de migratie die nog moet draaien, of null als alles er is. */
  const [aanwezigheidMigratie, setAanwezigheidMigratie] = useState<string | null>(null);
  /** Idem voor de plaats van aanmelden (kolommen land, regio, stad). */
  const [aanwezigheidLocatieMigratie, setAanwezigheidLocatieMigratie] = useState<string | null>(null);

  const fetchActivityLog = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/activity', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data)) {
        zetLogUitAntwoord(response, data, data);
      }
    } catch (error) {
      console.error('Error fetching activity log:', error);
    } finally {
      setActivityLogGeladen(true);
    }
  };

  const fetchLoginActivity = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/activity/logins', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data.logins)) {
        zetLoginsUitAntwoord(response, data.logins, data.logins);
      }
    } catch (error) {
      console.error('Error fetching login activity:', error);
    }
  };

  /**
   * Aanwezigheid: per persoon de periodes waarin hij het portaal open had.
   * Sinds 18-09 de bron voor "wie was wanneer actief"; het auditlogboek kon
   * die vraag niet beantwoorden (hoogstens één auth-regel per persoon per dag).
   */
  const fetchAanwezigheid = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/activity/presence', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data.sessies)) zetAanwezigheidUitAntwoord(response, data.sessies, data.sessies);
      setAanwezigheidMigratie(typeof data?.migratie === 'string' ? data.migratie : null);
      setAanwezigheidLocatieMigratie(typeof data?.locatieMigratie === 'string' ? data.locatieMigratie : null);
    } catch (error) {
      console.error('Error fetching aanwezigheid:', error);
    }
  };

  useEffect(() => {
    if (currentView === 'activiteit' && currentUser?.role === 'admin') {
      fetchActivityLog();
      fetchLoginActivity();
      fetchAanwezigheid();
    }
  }, [currentView, currentUser?.role]);

  // Zolang het scherm open staat de aanwezigheid bijhouden: "nu online" is
  // een live-getal en de hartslag is er per 5 minuten, dus vaker verversen
  // levert niets op. Alleen bij een zichtbaar tabblad, net als de andere polls.
  useEffect(() => {
    if (currentView !== 'activiteit' || currentUser?.role !== 'admin') return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetchAanwezigheid();
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, currentUser?.role]);

  /** Bij uitloggen: het logboek leeg (loginActivity blijft, zoals voorheen). */
  const resetActiviteit = () => {
    setActivityLog([]);
    setActivityLogGeladen(false);
    setAanwezigheid([]);
  };

  return {
    activityLog, activityLogGeladen, loginActivity, aanwezigheid, aanwezigheidMigratie, aanwezigheidLocatieMigratie,
    fetchActivityLog, fetchLoginActivity, fetchAanwezigheid, resetActiviteit,
  };
}
