import { sanitizeEditableText } from './text-utils.js';

export function hasStepDescription(screenshot) {
  return Boolean(sanitizeEditableText(screenshot?.description, 400));
}

export function getFallbackDescription(screenshot, index) {
  const interactionSummary = sanitizeEditableText(screenshot?.pageContext?.interaction?.summary, 240);
  if (interactionSummary) {
    return interactionSummary;
  }

  const pageTitle = sanitizeEditableText(screenshot?.pageContext?.title, 120);
  if (pageTitle) {
    return `查看 ${pageTitle}`;
  }

  return `步骤 ${index + 1}`;
}
