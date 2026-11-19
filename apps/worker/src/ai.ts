import { createOpenAI } from '@ai-sdk/openai';
import { generateText, Output } from 'ai';
import { titleLayout } from '@box/label';
import { z } from 'zod';

/** Max title length; set by the label's text budget (2 lines × ~14 chars, uppercase). */
export const TITLE_MAX = 24;

const extractionSchema = z.object({
  title: z
    .string()
    .describe(
      `A short label for the box: 1-3 words, max 20 characters total, no word longer than 12 characters. Printed on a tiny label in two lines of 12 characters. e.g. "Kitchen glassware", "Kids books & games", "Bathroom".`,
    ),
  room: z
    .string()
    .nullable()
    .describe(
      'The room these items most likely belong in at the new home, e.g. "Kitchen". null if unclear.',
    ),
  items: z
    .array(
      z.object({
        name: z
          .string()
          .describe('Concrete, searchable item name, e.g. "wine glasses", "HDMI cables".'),
        quantity: z.number().int().nullable().describe('Count if clearly visible, otherwise null.'),
      }),
    )
    .describe('Every distinct item or group of items visible in the box.'),
});

export type Extraction = z.infer<typeof extractionSchema>;

const SYSTEM = `You catalogue the contents of moving boxes from a photo looking into the open box.
- List the items you can actually see. Do not guess at items that are hidden.
- Group obvious multiples ("6 wine glasses" -> name "wine glasses", quantity 6).
- Use plain, searchable names a person would type when looking for the item later.
- Ignore packing material (paper, bubble wrap, tape) and the box itself.
- If existing items are provided, only return items that are NOT already in that list.`;

export async function extractContents(opts: {
  apiKey: string;
  model: string;
  image: Uint8Array;
  mediaType: string;
  existingItems?: string[];
}): Promise<Extraction> {
  const openai = createOpenAI({ apiKey: opts.apiKey });
  const existing = opts.existingItems?.length
    ? `Items already recorded for this box: ${opts.existingItems.join(', ')}.`
    : 'This is the first photo of this box.';

  const { output } = await generateText({
    model: openai(opts.model),
    output: Output.object({ schema: extractionSchema }),
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: `${existing} Describe what is in this box.` },
          { type: 'image', image: opts.image, mediaType: opts.mediaType },
        ],
      },
    ],
    abortSignal: AbortSignal.timeout(45_000),
  });

  return {
    ...output,
    title: fitTitle(output.title),
    items: output.items
      .map(({ name, quantity }) => ({ name: name.trim(), quantity }))
      .filter((item) => item.name),
  };
}

/** Make sure the title fits the printed label; drop leading words (adjectives) until it does. */
export function fitTitle(raw: string): string {
  let words = raw.trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && !titleLayout(words.join(' ')).fits) {
    words = words.slice(1);
  }
  const t = words.join(' ');
  const fitted = titleLayout(t).fits ? t : t.slice(0, 12);
  return fitted.charAt(0).toUpperCase() + fitted.slice(1);
}
