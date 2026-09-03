/**
 * What a build's live text may say, and what it may not.
 *
 * The coder loop streams the model's own prose to the conversation as it is
 * produced. That prose is worth showing — "reading src/App.tsx", "installing
 * the router" is the run narrating itself. The file bodies inside it are not:
 * the files reach the user as files, through the tree, the diff and the
 * running preview. Echoing them into the chat says the same thing twice, and
 * the larger of the two copies is the one nobody asked for.
 *
 * So: prose passes, fenced blocks are dropped. Inline code (single
 * backticks) is prose and survives — `useState` in a sentence is the
 * sentence, not a file.
 *
 * The filter is stateful because a fence rarely arrives whole: ``` routinely
 * straddles two network fragments, so a run of backticks at the end of one
 * fragment is held back until the next resolves whether it opened a fence or
 * was just text. At most two held-back backticks are lost if a run ends
 * mid-fragment, which costs a stray character and never a sentence.
 */

export type NarrationFilter = (fragment: string) => string;

const FENCE = '```';

export function createNarrationFilter(): NarrationFilter {
  let insideFence = false;
  let held = '';

  return function filter(fragment: string): string {
    let text = held + String(fragment ?? '');
    held = '';
    let out = '';

    for (;;) {
      const fence = text.indexOf(FENCE);
      if (fence === -1) break;
      if (!insideFence) out += text.slice(0, fence);
      insideFence = !insideFence;
      text = text.slice(fence + FENCE.length);
    }

    // A trailing ` or `` may be the opening of a fence that continues in the
    // next fragment. Emitting it now would leak the first characters of a
    // block that is about to be dropped, so it waits for the next fragment.
    const trailing = text.match(/`{1,2}$/);
    if (trailing) {
      held = trailing[0];
      text = text.slice(0, -trailing[0].length);
    }

    if (!insideFence) out += text;
    return out;
  };
}
