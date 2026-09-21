/**
 * Print-modus: `?print-…=` in de URL toont een kaal blad zonder zijbalk of
 * topbar, in plaats van de app. Stond tot 21-09 als blok van 90 regels in
 * App.tsx, tussen de sessie-opbouw en het inlogscherm (G1). De takken zijn
 * ongewijzigd verplaatst; `printScherm` geeft het blad terug, of null als de
 * URL geen printblad vraagt (of de rol het niet mag).
 *
 * Geen hooks hierbinnen: App roept dit aan ná al zijn eigen hooks, op de plek
 * waar de takken vroeger stonden.
 */
import { Suspense, type ReactNode } from 'react';
import type { LeaveRequest, Shift, User } from '../types';
import { lazyWithRetry } from '../lib/lazyRetry';
import { PrintLaden } from './PreAppScreens';

const LazyPrintMonthlyScheduleView = lazyWithRetry(() => import('../views/PrintMonthlyScheduleView').then((module) => ({ default: module.PrintMonthlyScheduleView })));
const LazyPrintLeaveYearView = lazyWithRetry(() => import('../views/PrintLeaveYearView').then((module) => ({ default: module.PrintLeaveYearView })));
const LazyPrintDienstwisselsView = lazyWithRetry(() => import('../views/PrintDienstwisselsView').then((module) => ({ default: module.PrintDienstwisselsView })));
const LazyPrintRapportView = lazyWithRetry(() => import('../views/PrintRapportView').then((module) => ({ default: module.PrintRapportView })));
const LazyPrintGeleBoekView = lazyWithRetry(() => import('../views/PrintGeleBoekView').then((module) => ({ default: module.PrintGeleBoekView })));

export function printScherm({ currentUser, users, shifts, leaveRequests, isInitialLoad }: {
  currentUser: User | null;
  users: User[];
  shifts: Shift[];
  leaveRequests: LeaveRequest[];
  isInitialLoad: boolean;
}): ReactNode | null {
  // Print-modus: kale weergave zonder sidebar/header. Vereist authenticated
  // planner/admin sessie zodat we de shifts kunnen lezen.
  const printParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const printDriverId = printParams?.get('print-driver');
  const printMonth = printParams?.get('print-month');
  if (printDriverId && printMonth && currentUser && (currentUser.role === 'planner' || currentUser.role === 'admin')) {
    // 'alle' = bulk: één stapel met een blad per chauffeur (paginawissel in
    // de print-CSS). Wacht op de collecties — de lijst chauffeurs en hun
    // shifts moeten er zijn vóór de auto-print afgaat.
    if (printDriverId === 'alle') {
      if (isInitialLoad) {
        return <PrintLaden />;
      }
      const bulkDrivers = users
        .filter((u) => u.isActive !== false && u.name.toLowerCase() !== 'beheerder')
        .sort((a, b) => a.name.localeCompare(b.name));
      return (
        <Suspense fallback={<PrintLaden />}>
          <LazyPrintMonthlyScheduleView drivers={bulkDrivers} monthIso={printMonth} shifts={shifts} />
        </Suspense>
      );
    }
    const driver = users.find((u) => String(u.id) === String(printDriverId)) || null;
    return (
      <Suspense fallback={<PrintLaden />}>
        <LazyPrintMonthlyScheduleView driver={driver} monthIso={printMonth} shifts={shifts} />
      </Suspense>
    );
  }

  // Verlof-jaaroverzicht: planner/admin voor iedereen, een chauffeur alleen
  // voor zichzelf (met zijn eigen currentUser en eigen verloflijst — de
  // users-collectie is voor chauffeurs niet volledig).
  // Papieren gele boek (ISO-map): techniekers en staf, haalt zelf zijn data op.
  const printGeleBoek = printParams?.get('print-gele-boek');
  if ((printGeleBoek === 'open' || printGeleBoek === 'alles') && currentUser && (currentUser.role === 'technieker' || currentUser.role === 'planner' || currentUser.role === 'admin')) {
    return (
      <Suspense fallback={<PrintLaden />}>
        <LazyPrintGeleBoekView filter={printGeleBoek} />
      </Suspense>
    );
  }

  // Weekoverzicht dienstwissels (bewijsstuk voor het klassement): planner/admin.
  // De view haalt de uitgevoerde wissels zelf op, alleen de planning komt uit
  // de collecties (voor de uren van de dienst).
  const printRuilWeek = printParams?.get('ruiloverzicht-week');
  if (printRuilWeek && /^\d{4}-\d{2}-\d{2}$/.test(printRuilWeek) && currentUser && (currentUser.role === 'planner' || currentUser.role === 'admin')) {
    if (isInitialLoad) {
      return <PrintLaden />;
    }
    return (
      <Suspense fallback={<PrintLaden />}>
        <LazyPrintDienstwisselsView dag={printRuilWeek} shifts={shifts} />
      </Suspense>
    );
  }

  // Rapporten (register in shared/rapporten): één printblad voor elk rapport,
  // met dezelfde filterparameters als het scherm (?print-rapport=<id>&jaar=…).
  // Het blad haalt zijn cijfers zelf op; de gebruikerslijst komt uit de
  // collecties (de naam van de gekozen chauffeur in de kop).
  const printRapport = printParams?.get('print-rapport');
  if (printRapport && currentUser && (currentUser.role === 'planner' || currentUser.role === 'admin')) {
    if (isInitialLoad) {
      return <PrintLaden />;
    }
    return (
      <Suspense fallback={<PrintLaden />}>
        <LazyPrintRapportView rapportId={printRapport} users={users} door={currentUser.name} />
      </Suspense>
    );
  }

  const printVerlofDriverId = printParams?.get('print-verlof-driver');
  const printVerlofJaar = Number(printParams?.get('print-verlof-jaar'));
  if (printVerlofDriverId && Number.isInteger(printVerlofJaar) && printVerlofJaar > 2000 && currentUser) {
    const isPlannerRole = currentUser.role === 'planner' || currentUser.role === 'admin';
    const isSelf = String(currentUser.id) === String(printVerlofDriverId);
    if (isPlannerRole || isSelf) {
      // Pas renderen als de collecties er zijn: de view print automatisch,
      // en dat mag niet gebeuren met een nog lege verloflijst.
      if (isInitialLoad) {
        return <PrintLaden />;
      }
      const driver = isSelf ? currentUser : users.find((u) => String(u.id) === String(printVerlofDriverId)) || null;
      return (
        <Suspense fallback={<PrintLaden />}>
          <LazyPrintLeaveYearView driver={driver} year={printVerlofJaar} leaves={leaveRequests} />
        </Suspense>
      );
    }
  }

  return null;
}
