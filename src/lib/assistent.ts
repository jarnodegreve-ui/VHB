import { apiJson } from './api';

/**
 * Planner-assistent — chat met Claude als motor (server-side, POST
 * /api/planner-chat). De client stuurt de hele gespreksgeschiedenis mee (de
 * server bewaart niets); het antwoord is platte tekst. De harde invalregels
 * zitten server-side in de tools — de assistent adviseert alleen.
 */
export type AssistentBericht = {
  role: 'user' | 'assistant';
  content: string;
};

export function vraagAssistent(messages: AssistentBericht[]): Promise<{ antwoord: string }> {
  return apiJson<{ antwoord: string }>('/api/planner-chat', {
    method: 'POST',
    body: JSON.stringify({ messages }),
  });
}
