import type express from "express";
import { timingSafeEqual } from "node:crypto";
import { escapeHtml } from "./email.js";
import { getLeaveData, getPlanningData, getUsersData } from "./storage.js";
import type { DayGap } from "./coverageGaps.js";

/**
 * Telegram-koppeling voor de planner — het beproefde patroon uit Jarno's
 * andere apps (webhook met secret-header, chat-id via env, tokens nooit in
 * code of chat). Eén gekoppelde chat (de planner); al het andere wordt stil
 * genegeerd. Alles hier is lezen-en-melden: de bot kan niets wijzigen, dus
 * dubbele afleveringen door Telegram-retries zijn onschadelijk — daarom
 * bewust géén update_id-administratie (afwijking van het capture-patroon,
 * waar dubbele verwerking wél taken dupliceerde).
 *
 * Env: TELEGRAM_BOT_TOKEN (van BotFather), TELEGRAM_WEBHOOK_SECRET (zelf
 * gegenereerd, meegegeven aan setWebhook), TELEGRAM_CHAT_ID (de gekoppelde
 * chat; /start toont hem zolang hij nog niet ingesteld is).
 */

const botToken = () => String(process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
const gekoppeldeChat = () => String(process.env.TELEGRAM_CHAT_ID ?? "").trim();

export const telegramGeconfigureerd = (): boolean => Boolean(botToken() && gekoppeldeChat());

export type TelegramKnop = { tekst: string; data: string };

type Verzending = {
  chatId: string;
  tekst: string;
  knoppen?: TelegramKnop[][];
};

const echteVerzender = async (v: Verzending): Promise<boolean> => {
  const token = botToken();
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: v.chatId,
        text: v.tekst,
        // HTML i.p.v. Markdown: namen met _ of * braken Markdown-parsing
        // (bekende valkuil uit de eerdere bots).
        parse_mode: "HTML",
        ...(v.knoppen && v.knoppen.length > 0
          ? { reply_markup: { inline_keyboard: v.knoppen.map((rij) => rij.map((k) => ({ text: k.tekst, callback_data: k.data }))) } }
          : {}),
      }),
    });
    if (!res.ok) console.error("[telegram] sendMessage faalde:", res.status, (await res.text()).slice(0, 300));
    return res.ok;
  } catch (err: any) {
    console.error("[telegram] sendMessage faalde:", err?.message ?? err);
    return false;
  }
};

// Injecteerbare verzender zodat integratietests de uitgaande berichten kunnen
// opvangen zonder echt netwerkverkeer (zelfde idee als de storage-mock).
let verzender = echteVerzender;
export const zetTelegramVerzenderVoorTests = (v: typeof echteVerzender | null) => {
  verzender = v ?? echteVerzender;
};

/** Stuur een bericht naar de gekoppelde planner-chat. Best-effort: nooit
 *  throwen — een kapotte Telegram-config mag geen enkele flow breken. */
export const stuurTelegram = async (
  tekst: string,
  opts?: { knoppen?: TelegramKnop[][]; chatId?: string },
): Promise<boolean> => {
  const chatId = opts?.chatId ?? gekoppeldeChat();
  if (!chatId) return false;
  return verzender({ chatId, tekst, knoppen: opts?.knoppen });
};

const answerCallback = async (callbackId: string, tekst?: string): Promise<void> => {
  const token = botToken();
  if (!token) return;
  try {
    // Zonder antwoord blijft de knop in de Telegram-app eeuwig "laden"
    // (bekende valkuil uit de eerdere bots).
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackId, ...(tekst ? { text: tekst } : {}) }),
    });
  } catch (err: any) {
    console.error("[telegram] answerCallbackQuery faalde:", err?.message ?? err);
  }
};

const timingSafeGelijk = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
};

// ---------------------------------------------------------------------------
// Opmaak — compact genoeg voor een telefoonscherm, namen altijd ge-escaped.
// ---------------------------------------------------------------------------

const DAG_KORT = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("nl-BE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Brussels" });

/** Openstaande diensten als bericht + kandidaten-knoppen (max 8). */
export const formatGaten = (dagen: DayGap[]): { tekst: string; knoppen: TelegramKnop[][] } => {
  const metGaten = dagen.filter((d) => d.missing.length > 0);
  if (metGaten.length === 0) {
    return { tekst: "✅ Geen openstaande diensten in deze periode.", knoppen: [] };
  }
  const regels: string[] = [];
  const knoppen: TelegramKnop[][] = [];
  for (const d of metGaten) {
    const items = d.missing.map((code) => {
      const info = d.uitval?.[code.trim().toLowerCase()];
      return info ? `${code} (${escapeHtml(info.name)} · ${escapeHtml(info.reason)})` : code;
    });
    regels.push(`<b>${DAG_KORT(d.date)}</b>${d.dayType ? ` · ${escapeHtml(d.dayType)}` : ""} — ${items.join(", ")}`);
    for (const code of d.missing) {
      if (knoppen.length >= 8) break;
      knoppen.push([{ tekst: `👤 Kandidaten ${DAG_KORT(d.date)} · ${code}`, data: `adv|${d.date}|${code}` }]);
    }
  }
  const totaal = metGaten.reduce((n, d) => n + d.missing.length, 0);
  return {
    tekst: `⚠️ <b>${totaal} openstaande dienst${totaal === 1 ? "" : "en"}</b>\n${regels.join("\n")}`,
    knoppen,
  };
};

/** Het invaladvies voor één gat, in de vorm van de collega-samenvatting. */
export const formatAdvies = (
  date: string,
  code: string,
  advies: { samenvatting?: string; kandidaten?: Array<{ name: string; past: boolean }> },
): string => {
  const passend = (advies.kandidaten ?? []).filter((k) => k.past).slice(0, 3);
  const regels = [
    `👤 <b>Dienst ${escapeHtml(code)} · ${DAG_KORT(date)}</b>`,
    escapeHtml(String(advies.samenvatting ?? "Geen advies beschikbaar.")),
  ];
  if (passend.length > 0) {
    regels.push(`Passend: ${passend.map((k) => escapeHtml(k.name)).join(", ")}.`);
  }
  regels.push("Toewijzen doe je in het portaal → Openstaande diensten.");
  return regels.join("\n");
};

const vandaagIso = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });

const formatZiek = async (): Promise<string> => {
  const vandaag = vandaagIso();
  const [leave, users] = await Promise.all([getLeaveData({ endOnOrAfter: vandaag }), getUsersData()]);
  const naam = (id: string) => (users as any[]).find((u) => String(u.id) === id)?.name ?? "Onbekend";
  const actueel = (leave as any[])
    .filter((l) => l?.status === "approved" && l?.type === "ziekte" && String(l.endDate) >= vandaag)
    .sort((a, b) => String(a.endDate).localeCompare(String(b.endDate)));
  if (actueel.length === 0) return "✅ Niemand ziek gemeld op dit moment.";
  const regels = actueel.map((l) => {
    const start = String(l.startDate);
    const eind = String(l.endDate);
    const status = start > vandaag ? `vanaf ${DAG_KORT(start)}` : `t/m ${DAG_KORT(eind)}`;
    return `• ${escapeHtml(naam(String(l.userId)))} — ${status}`;
  });
  return `🤒 <b>Ziek gemeld (${actueel.length})</b>\n${regels.join("\n")}`;
};

const formatVandaag = async (dagen: DayGap[]): Promise<string> => {
  const vandaag = vandaagIso();
  const planning = await getPlanningData({ monthIso: vandaag.slice(0, 7) });
  const rijen = (planning as any[]).filter((s) => String(s.date) === vandaag);
  const diensten = new Set(rijen.map((s) => String(s.line ?? "").trim()).filter(Boolean));
  const chauffeurs = new Set(rijen.map((s) => String(s.driverId)));
  const gat = dagen.find((d) => d.date === vandaag);
  const open = gat?.missing ?? [];
  const regels = [
    `📅 <b>Vandaag (${DAG_KORT(vandaag)})</b>`,
    `${diensten.size} dienst${diensten.size === 1 ? "" : "en"} ingepland, ${chauffeurs.size} chauffeur${chauffeurs.size === 1 ? "" : "s"}.`,
    open.length > 0 ? `⚠️ Open: ${open.join(", ")}.` : "✅ Alles ingevuld.",
  ];
  return regels.join("\n");
};

const HULP = [
  "Ik ben de VHB-portaal-bot. Commando's:",
  "/gaten — openstaande diensten komende 7 dagen (met kandidaten-knoppen)",
  "/ziek — wie is er nu ziek gemeld",
  "/vandaag — de dag in het kort",
].join("\n");

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

export type TelegramDeps = {
  berekenDekkingsGaten: (from: string, to: string) => Promise<DayGap[]>;
  berekenCoverageAdvies: (date: string, code: string) => Promise<any>;
  addDagen: (iso: string, n: number) => string;
};

export function mountTelegramRoutes(app: express.Express, deps: TelegramDeps) {
  app.post("/api/telegram/webhook", async (req, res) => {
    try {
      // Secret-validatie eerst; zonder geconfigureerd secret is de webhook
      // dicht (fail-closed, zelfde principe als de cron-endpoints).
      const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
      const header = String(req.headers["x-telegram-bot-api-secret-token"] ?? "");
      if (!secret || !timingSafeGelijk(header, secret)) {
        return res.status(401).json({ error: "Ongeldige webhook." });
      }

      const update = req.body ?? {};
      const bekend = gekoppeldeChat();

      // Knoppen (callback_query): alleen vanuit de gekoppelde chat.
      const cb = update.callback_query;
      if (cb) {
        const vanChat = String(cb.message?.chat?.id ?? "");
        if (!bekend || vanChat !== bekend) {
          await answerCallback(String(cb.id ?? ""));
          return res.json({ ok: true });
        }
        const data = String(cb.data ?? "");
        if (data.startsWith("adv|")) {
          const [, date, code] = data.split("|");
          await answerCallback(String(cb.id ?? ""), "Advies berekenen…");
          try {
            const advies = await deps.berekenCoverageAdvies(String(date ?? ""), String(code ?? ""));
            await stuurTelegram(formatAdvies(String(date ?? ""), String(code ?? ""), advies));
          } catch {
            await stuurTelegram(`Advies voor dienst ${escapeHtml(String(code ?? ""))} kon niet berekend worden.`);
          }
        } else {
          await answerCallback(String(cb.id ?? ""));
        }
        return res.json({ ok: true });
      }

      const msg = update.message;
      const vanChat = String(msg?.chat?.id ?? "");
      if (!vanChat) return res.json({ ok: true });
      const tekst = String(msg?.text ?? "").trim();

      // Nog niet gekoppeld: /start toont de chat-id zodat die (buiten deze
      // chat om) als TELEGRAM_CHAT_ID in de env gezet kan worden. Andere
      // berichten van wie dan ook: stil negeren.
      if (!bekend) {
        if (tekst.startsWith("/start")) {
          await stuurTelegram(
            `Deze chat heeft id <code>${escapeHtml(vanChat)}</code>.\nZet die waarde als TELEGRAM_CHAT_ID in de Vercel-omgeving en redeploy — daarna is de bot gekoppeld.`,
            { chatId: vanChat },
          );
        }
        return res.json({ ok: true });
      }
      if (vanChat !== bekend) return res.json({ ok: true });

      if (tekst.startsWith("/start") || tekst.startsWith("/help")) {
        await stuurTelegram(HULP);
      } else if (tekst.startsWith("/gaten")) {
        const vandaag = vandaagIso();
        const dagen = await deps.berekenDekkingsGaten(vandaag, deps.addDagen(vandaag, 6));
        const { tekst: bericht, knoppen } = formatGaten(dagen);
        await stuurTelegram(bericht, { knoppen });
      } else if (tekst.startsWith("/ziek")) {
        await stuurTelegram(await formatZiek());
      } else if (tekst.startsWith("/vandaag")) {
        const vandaag = vandaagIso();
        const dagen = await deps.berekenDekkingsGaten(vandaag, vandaag);
        await stuurTelegram(await formatVandaag(dagen));
      } else if (tekst) {
        await stuurTelegram(`Dat commando ken ik niet.\n\n${HULP}`);
      }
      return res.json({ ok: true });
    } catch (err: any) {
      console.error("[telegram] webhook faalde:", err?.message ?? err);
      // Tóch 200: bij een 5xx blijft Telegram dezelfde update opnieuw
      // aanbieden, en alles hier is lezen-en-melden — herhalen helpt niet.
      return res.json({ ok: false });
    }
  });
}
