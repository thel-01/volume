// ---------------------------------------------------------------------------
// Recommendation tag — a small floating hint above a chip, nudging you
// toward one option among several (dashboard.html's start-workout
// "longest since" chip). DOM-only, no app-specific data: the caller
// decides which chip gets tagged and what the tag says.
//
// The chip is position:relative (see .chip in styles.css), so the tag's
// absolutely-positioned .hint child is placed against the chip's PADDING
// box, not its visible border — left:0/right:0 alone lands 1px inside the
// chip's own border rather than flush with it. CHIP_BORDER compensates so
// the tag's outer edge lines up with the chip's actual outer edge.
// ---------------------------------------------------------------------------

const CHIP_BORDER = 1;

/**
 * Marks a chip as the suggested one and attaches its floating tag.
 * Call positionHint() after the chip is in the DOM and laid out — this
 * only builds the markup, it doesn't measure anything.
 */
export function tagChip(chip, text) {
  chip.classList.add('suggested');
  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.textContent = text;
  chip.appendChild(hint);
  return hint;
}

/** Re-anchors a tagged chip's floating hint if centering would push it past the chip row's own edge. */
export function positionHint(chip, container) {
  const hint = chip.querySelector('.hint');
  if (!hint) return;
  hint.style.left = '50%';
  hint.style.right = 'auto';
  hint.style.transform = 'translateX(-50%)';
  const hintRect = hint.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const margin = 2;
  if (hintRect.left < containerRect.left + margin) {
    hint.style.left = `-${CHIP_BORDER}px`;
    hint.style.transform = 'none';
  } else if (hintRect.right > containerRect.right - margin) {
    hint.style.left = 'auto';
    hint.style.right = `-${CHIP_BORDER}px`;
    hint.style.transform = 'none';
  }
}
