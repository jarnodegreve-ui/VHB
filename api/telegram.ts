import type express from "express";
import { timingSafeEqual } from "node:crypto";
import { escapeHtml } from "./email.js";
import { getLeaveData, getPlanningData, getPlanningCodesData, getPlanningMatrixRows, getServicesData, getUsersData } from "./storage.js";
import { matrixCodesForDate, toLookupToken } from "./helpers.js";
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

/** ISO-dag + n dagen (lokale kopie — puur datumrekenen in UTC-frame). */
const addDagenIso = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Planning-rijen (de actuele, ruil-correcte waarheid) binnen [van, tot]. */
const planningInVenster = async (van: string, tot: string): Promise<any[]> => {
  const maanden = new Set<string>();
  for (let d = van; d <= tot; d = addDagenIso(d, 1)) maanden.add(d.slice(0, 7));
  const chunks = await Promise.all([...maanden].map((m) => getPlanningData({ monthIso: m })));
  return (chunks.flat() as any[]).filter((s) => {
    const d = String(s?.date ?? "");
    return d >= van && d <= tot;
  });
};

const dienstSegmenten = (s: any): string[] => [
  s.startTime && s.endTime ? `${s.startTime}–${s.endTime}${s.loopnr ? ` (loop ${s.loopnr})` : ""}` : "",
  s.startTime2 && s.endTime2 ? `${s.startTime2}–${s.endTime2}${s.loopnr2 ? ` (loop ${s.loopnr2})` : ""}` : "",
  s.startTime3 && s.endTime3 ? `${s.startTime3}–${s.endTime3}${s.loopnr3 ? ` (loop ${s.loopnr3})` : ""}` : "",
].filter(Boolean);

/** /dienst <code>: de tijden uit het Dienstoverzicht (of de planningscode-uitleg). */
const formatDienst = async (code: string): Promise<string> => {
  if (!code) return "Gebruik: /dienst &lt;nummer&gt; — bv. /dienst 2601.";
  const [services, codes] = await Promise.all([getServicesData(), getPlanningCodesData()]);
  const svc = (services as any[]).find((s) => toLookupToken(String(s.serviceNumber ?? "")) === toLookupToken(code));
  if (svc) {
    const seg = dienstSegmenten(svc);
    return `🚌 <b>Dienst ${escapeHtml(String(svc.serviceNumber))}</b>\n${seg.length > 0 ? seg.map((x) => `• ${escapeHtml(x)}`).join("\n") : "Geen tijden in het Dienstoverzicht."}`;
  }
  const pc = (codes as any[]).find((c) => toLookupToken(String(c.code ?? "")) === toLookupToken(code));
  if (pc) return `ℹ️ ${escapeHtml(code)} is geen dienst maar een planningscode: ${escapeHtml(String(pc.description || pc.code))}.`;
  return `Dienst ${escapeHtml(code)} staat niet in het Dienstoverzicht.`;
};

/** /wie <code>: wie rijdt deze dienst in [van, tot] (ruil-correct). */
const formatWie = async (code: string, van: string, tot: string): Promise<string> => {
  if (!code) return "Gebruik: /wie &lt;dienstnummer&gt; — bv. /wie 2114.";
  const [rijen, users] = await Promise.all([planningInVenster(van, tot), getUsersData()]);
  const naam = (id: string) => (users as any[]).find((u) => String(u.id) === id)?.name ?? `Onbekend (${id})`;
  const perDag = new Map<string, Set<string>>();
  for (const s of rijen) {
    if (toLookupToken(String(s.line ?? "")) !== toLookupToken(code)) continue;
    const d = String(s.date);
    if (!perDag.has(d)) perDag.set(d, new Set());
    perDag.get(d)!.add(naam(String(s.driverId)));
  }
  if (perDag.size === 0) return `Niemand ingepland op dienst ${escapeHtml(code)} van ${DAG_KORT(van)} t/m ${DAG_KORT(tot)}.`;
  const regels = [...perDag.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, namen]) => `• ${DAG_KORT(d)}: ${[...namen].map(escapeHtml).join(", ")}`);
  return `🚌 <b>Dienst ${escapeHtml(code)}</b> — ${DAG_KORT(van)} t/m ${DAG_KORT(tot)}:\n${regels.join("\n")}`;
};

/** /rooster <naam>: iemands week — diensten uit de planning (ruil-correct),
 *  andere dagen de matrix-code (vrij/ziek/bv…). */
const formatRooster = async (query: string, van: string, tot: string): Promise<string> => {
  if (!query) return "Gebruik: /rooster &lt;naam&gt; — bv. /rooster Danny.";
  const users = await getUsersData();
  const chauffeurs = (users as any[]).filter((u) => u.role === "chauffeur" && u.isActive !== false);
  const q = toLookupToken(query);
  const matches = chauffeurs.filter((u) => toLookupToken(String(u.name ?? "")).includes(q));
  if (matches.length === 0) return `Geen chauffeur gevonden voor "${escapeHtml(query)}".`;
  if (matches.length > 1) {
    return `Meerdere chauffeurs matchen "${escapeHtml(query)}": ${matches.slice(0, 6).map((u) => escapeHtml(String(u.name))).join(", ")}${matches.length > 6 ? ", …" : ""}. Wees iets specifieker.`;
  }
  const u = matches[0];
  const [rijen, matrix] = await Promise.all([planningInVenster(van, tot), getPlanningMatrixRows()]);
  const perDag = new Map<string, string[]>();
  for (const s of rijen) {
    if (String(s.driverId) !== String(u.id)) continue;
    const d = String(s.date);
    const tijd = s.startTime && s.endTime ? ` (${s.startTime}–${s.endTime})` : "";
    perDag.set(d, [...(perDag.get(d) ?? []), `${String(s.line ?? "?")}${tijd}`]);
  }
  const regels: string[] = [];
  for (let d = van; d <= tot; d = addDagenIso(d, 1)) {
    const diensten = perDag.get(d);
    if (diensten) {
      regels.push(`• ${DAG_KORT(d)}: ${diensten.map(escapeHtml).join(" + ")}`);
      continue;
    }
    const cel = matrixCodesForDate(matrix as any[], [{ id: String(u.id), name: String(u.name) }], d).get(String(u.id));
    regels.push(`• ${DAG_KORT(d)}: ${cel ? escapeHtml(cel) : "—"}`);
  }
  return `📋 <b>${escapeHtml(String(u.name))}</b> — ${DAG_KORT(van)} t/m ${DAG_KORT(tot)}:\n${regels.join("\n")}`;
};

const HULP = [
  "Ik ben de VHB-portaal-bot. Commando's:",
  "/gaten — openstaande diensten komende 7 dagen (met kandidaten-knoppen)",
  "/ziek — wie is er nu ziek gemeld",
  "/vandaag — de dag in het kort",
  "/wie 2114 — wie rijdt deze dienst, komende 7 dagen",
  "/rooster Danny — iemands week",
  "/dienst 2601 — de tijden van een dienst",
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

      // Commando + argument; "@botnaam"-suffix strippen (stuurt Telegram in
      // groepen mee — wij zitten in een privéchat, maar defensief kost niks).
      const [cmdRaw = "", ...rest] = tekst.split(/\s+/);
      const cmd = cmdRaw.toLowerCase().replace(/@[\w_]+$/, "");
      const arg = rest.join(" ").trim();
      const vandaag = vandaagIso();
      const eindWeek = deps.addDagen(vandaag, 6);

      if (cmd === "/start" || cmd === "/help") {
        await stuurTelegram(HULP);
      } else if (cmd === "/gaten") {
        const dagen = await deps.berekenDekkingsGaten(vandaag, eindWeek);
        const { tekst: bericht, knoppen } = formatGaten(dagen);
        await stuurTelegram(bericht, { knoppen });
      } else if (cmd === "/ziek") {
        await stuurTelegram(await formatZiek());
      } else if (cmd === "/vandaag") {
        const dagen = await deps.berekenDekkingsGaten(vandaag, vandaag);
        await stuurTelegram(await formatVandaag(dagen));
      } else if (cmd === "/wie") {
        await stuurTelegram(await formatWie(arg, vandaag, eindWeek));
      } else if (cmd === "/rooster") {
        await stuurTelegram(await formatRooster(arg, vandaag, eindWeek));
      } else if (cmd === "/dienst") {
        await stuurTelegram(await formatDienst(arg));
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
