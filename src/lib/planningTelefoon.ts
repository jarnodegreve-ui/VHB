import type { User } from '../types';
import { telHref } from './ui';

/**
 * tel:-link naar de planning: de eerste planner met een nummer, anders een
 * beheerder. Eén plek voor het rooster (de uitweg bij een verlof-conflict)
 * en de ruilwizard (geen komende dienst om te ruilen); geen nummer in code.
 */
export const planningTelefoon = (users: User[]): string | undefined => {
  const kandidaat = users.find((u) => u.role === 'planner' && u.phone?.trim()) ?? users.find((u) => u.role === 'admin' && u.phone?.trim());
  return telHref(kandidaat?.phone);
};
