import type { SuggestedTag } from '../types';

/** Create a colored tag chip element. */
export function createTagChip(
	container: HTMLElement,
	tag: SuggestedTag,
): HTMLElement {
	const chip = container.createEl('span', {
		cls: `atw-tag-chip atw-tag-${tag.reviewStatus ?? 'pending'}`,
		text: tag.label,
	});
	if (tag.isExisting) {
		chip.addClass('atw-tag-existing');
	}
	return chip;
}

/** Create a confidence badge (e.g. "0.92"). */
export function createConfidenceBadge(
	container: HTMLElement,
	confidence: number,
): HTMLElement {
	const level = confidence >= 0.8 ? 'high' : confidence >= 0.5 ? 'medium' : 'low';
	return container.createEl('span', {
		cls: `atw-confidence atw-confidence-${level}`,
		text: confidence.toFixed(2),
	});
}

/** Create a facet section header. */
export function createFacetHeader(
	container: HTMLElement,
	facetName: string,
	required: boolean,
): HTMLElement {
	const header = container.createEl('div', { cls: 'atw-facet-header' });
	header.createEl('span', { cls: 'atw-facet-name', text: facetName });
	if (required) {
		header.createEl('span', { cls: 'atw-facet-required', text: 'required' });
	}
	return header;
}

/** Create accept / reject buttons for a tag suggestion. */
export function createReviewButtons(
	container: HTMLElement,
	tag: SuggestedTag,
	onAccept: () => void,
	onReject: () => void,
): HTMLElement {
	const btnGroup = container.createEl('span', { cls: 'atw-review-buttons' });

	const acceptBtn = btnGroup.createEl('button', {
		cls: 'atw-btn atw-btn-accept',
		text: '\u2713',
		attr: { 'aria-label': 'Accept tag' },
	});
	acceptBtn.addEventListener('click', onAccept);

	const rejectBtn = btnGroup.createEl('button', {
		cls: 'atw-btn atw-btn-reject',
		text: '\u2717',
		attr: { 'aria-label': 'Reject tag' },
	});
	rejectBtn.addEventListener('click', onReject);

	return btnGroup;
}
