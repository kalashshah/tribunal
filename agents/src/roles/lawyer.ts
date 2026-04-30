import type { AxlClient } from "../transport/axl.js";
import type { Llm, LlmMessage } from "../llm/client.js";
import { askParty, type Party, tryParseJsonObject } from "./qa.js";
import type { PartyAgent } from "./party.js";

export interface LawyerArgs {
  side: Party;
  brief: string;                      // initial seed: accusation text or defense framing
  ensName: string;                    // own ENS (the lawyer agent)
  clientEns?: string;                 // ENS of the human party we represent (optional, kept for compat)
  opponentEns?: string;               // ENS of the opposing party (optional, kept for compat)
  partyEns?: { accuser: string; defendant: string };
  clerkPeerId: string;
  caseId: string;
  llm: Llm;
  axl: AxlClient;
  model: string;
  partyAgent: PartyAgent;             // autonomous party agent for Q&A
  getTranscript?: () => string;       // optional: clerk.render() for party agent context
  partyAddress: { accuser: string; defendant: string };
  backendUrl: string;
  mode: "human" | "auto";
  qaTimeoutMs?: number;
  /// Optional pre-rendered case docket text. Re-render between phases for
  /// fresh evidence; the lawyer captures it by closure at construction time.
  docketText?: string;
}

export interface Lawyer {
  /// Discovery interview: ask own client up to N clarifying questions, then
  /// file a brief summarizing what was confirmed.
  interview(): Promise<void>;

  openingStatement(): Promise<string>;

  /// Cross-examine the opposing party (questions go directly to the human
  /// user representing the other side). Emits a summary `argument` event.
  crossExamine(): Promise<void>;

  rebuttal(opposingArgument: string): Promise<string>;
  closingStatement(transcriptText: string): Promise<string>;
}

const SYSTEM = (side: string, brief: string, docketText: string) =>
  `You are an experienced trial lawyer representing the ${side} in the Tribunal AI court.

Original brief from your client:
${brief}

${docketText}

Discipline:
- Cite ONLY items from the case docket above (by their evd_ ids) or statements already in the trial transcript.
- NEVER invent statutes, case law, contract terms, dates, dollar amounts, transaction hashes, names, or quotes.
- During discovery, your job is to surface DOCKET-LEVEL specifics from your client (tx hashes, dates from messages, exact contract clauses). Ask for the missing concrete artifact, not abstract reasoning.
- If a material fact is missing AND not in the docket, ASK your client (you have a question budget per phase). If after asking the client cannot produce it, do not argue it.
- Each statement: claim → evidence (cite [evd_…] or transcript) → conclusion. Be terse.
- If you do not have enough to argue something, say so plainly rather than guess.

You will be asked to act in phases (discovery, opening, cross-examination, rebuttal, closing). Maintain consistency with what you've already said earlier in the case.`;

interface Action {
  action: "ask" | "speak";
  question?: string;
  body?: string;
}

export function createLawyer(a: LawyerArgs): Lawyer {
  // Threaded message memory across all phases — the lawyer remembers its own
  // earlier turns and any client answers it received. This makes later
  // arguments coherent with earlier ones (M5).
  const memory: LlmMessage[] = [];

  async function think(prompt: string, json: boolean): Promise<string> {
    memory.push({ role: "user", content: prompt });
    const out = await a.llm.complete({
      system: SYSTEM(a.side, a.brief, a.docketText ?? "Case docket: (not yet loaded)"),
      messages: memory,
      ...(json ? { responseFormat: "json" as const } : {}),
    });
    memory.push({ role: "assistant", content: out.text });
    return out.text;
  }

  async function emit(kind: "argument" | "briefing", body: string): Promise<void> {
    await a.axl.send(a.clerkPeerId, {
      kind,
      from: a.ensName,
      body,
      meta: { side: a.side, caseId: a.caseId },
    });
  }

  /// Tool-loop: ask up to `maxAsks` questions to `target`, then speak.
  /// Each ask appends the answer to memory so the next decision is informed.
  async function loop(
    initial: string,
    target: Party,
    maxAsks: number,
    finalKind: "argument" | "briefing",
  ): Promise<string> {
    const protocol =
      `\n\nRespond with ONE JSON object only:\n` +
      `  {"action":"ask","question":"<one short question>"} -- to gather a missing fact\n` +
      `  {"action":"speak","body":"<your statement>"}        -- when you're ready\n` +
      `Question budget remaining will be told to you each turn. ` +
      `Prefer asking when material facts are missing; otherwise speak.`;

    let prompt = `${initial}${protocol}\nYou may ask up to ${maxAsks} question${maxAsks === 1 ? "" : "s"} this phase.`;
    let asked = 0;

    for (let step = 0; step < maxAsks + 2; step++) {
      const raw = await think(prompt, true);
      const act = tryParseJsonObject<Action>(raw);

      if (!act) {
        // Free model didn't produce JSON; treat raw as the speech.
        await emit(finalKind, raw.trim());
        return raw.trim();
      }

      if (act.action === "ask" && act.question && asked < maxAsks) {
        asked++;
        try {
          const transcriptSoFar = a.getTranscript?.() ?? "";
          const answer = await askParty(
            {
              caseId: a.caseId,
              axl: a.axl,
              clerkPeerId: a.clerkPeerId,
              asker: a.ensName,
              askerSide: a.side,
              partyEns: a.partyEns ?? { accuser: "", defendant: "" },
              partyAddress: a.partyAddress,
              backendUrl: a.backendUrl,
              mode: a.mode,
              timeoutMs: a.qaTimeoutMs,
            },
            target,
            act.question,
            transcriptSoFar,
            a.partyAgent,
          );
          prompt =
            `${target} answered: ${answer}\n\n` +
            `Question budget remaining: ${maxAsks - asked}. Decide next step (JSON only).`;
        } catch (e) {
          prompt =
            `(no answer received within deadline)\n\n` +
            `Question budget remaining: ${maxAsks - asked}. Speak now (JSON only).`;
        }
        continue;
      }

      if (act.action === "speak" && typeof act.body === "string") {
        await emit(finalKind, act.body);
        return act.body;
      }

      // model said `ask` but we're out of budget — force speak
      prompt = `Question budget exhausted. Speak now (JSON only): {"action":"speak","body":"..."}`;
    }

    // Safety net.
    const final = await think(`Speak now. JSON only: {"action":"speak","body":"..."}`, true);
    const parsed = tryParseJsonObject<Action>(final);
    const body = parsed?.body ?? final.trim();
    await emit(finalKind, body);
    return body;
  }

  /// Single-shot speech with full memory but no question budget.
  async function speak(prompt: string, finalKind: "argument" | "briefing" = "argument"): Promise<string> {
    const out = await think(prompt, false);
    await emit(finalKind, out);
    return out;
  }

  return {
    async interview() {
      await loop(
        `Discovery phase. Read the brief and identify the 1-3 most important facts you'd need confirmed before opening. ` +
          `Ask your client for them, then file a short brief that lists what you confirmed (and what they couldn't confirm).`,
        a.side,
        3,
        "briefing",
      );
    },

    async openingStatement() {
      return speak(
        `Opening statement. Use only confirmed facts from your discovery brief and the original client brief. ` +
          `Under 200 words. Structure: claim → evidence → conclusion. No fabrication.`,
      );
    },

    async crossExamine() {
      const opposing: Party = a.side === "accuser" ? "defendant" : "accuser";
      await loop(
        `Cross-examination of the ${opposing}. You may put up to 2 pointed questions DIRECTLY to the ${opposing} ` +
          `to expose weaknesses or surface admissions. After receiving answers (or none), state in one paragraph what ` +
          `the answers (or refusals) show.`,
        opposing,
        2,
        "argument",
      );
    },

    async rebuttal(opposingArgument) {
      return speak(
        `The ${a.side === "accuser" ? "defendant" : "accuser"} just argued:\n${opposingArgument}\n\n` +
          `Rebut. Address their strongest point first. Be specific. Under 180 words.`,
      );
    },

    async closingStatement(transcriptText) {
      return speak(
        `Trial transcript so far:\n${transcriptText}\n\n` +
          `Closing statement. Tie your strongest evidence to the relief you seek. Under 200 words.`,
      );
    },
  };
}
