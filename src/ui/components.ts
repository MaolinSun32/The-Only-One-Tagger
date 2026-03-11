import type { SuggestedTag } from '../types';
import { normalizeTagId } from '../utils/normalization';

/** Create an editable tag chip input. */
export function createTagChip(
	container: HTMLElement,
	tag: SuggestedTag,
	onRename?: (newLabel: string) => void,
): HTMLElement {
	const chip = container.createEl('input', {
		cls: `atw-tag-chip atw-tag-${tag.reviewStatus ?? 'pending'}`,
		attr: {
			type: 'text',
			value: tag.label,
			spellcheck: 'false',
		},
	});
	chip.value = tag.label;
	// Auto-size to content
	chip.size = Math.max(tag.label.length, 4);
	if (tag.isExisting) {
		chip.addClass('atw-tag-existing');
	}
	chip.addEventListener('input', () => {
		chip.size = Math.max(chip.value.length, 4);
	});
	chip.addEventListener('change', () => {
		const newLabel = chip.value.trim();
		if (newLabel && newLabel !== tag.label) {
			tag.label = newLabel;
			tag.tagId = normalizeTagId(newLabel);
			onRename?.(newLabel);
		}
	});
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

	const isAccepted = tag.reviewStatus === 'accepted';
	const isRejected = tag.reviewStatus === 'rejected';

	const acceptBtn = btnGroup.createEl('button', {
		cls: `atw-btn atw-btn-accept${isAccepted ? ' atw-btn-active' : ''}`,
		text: '\u2713',
		attr: { 'aria-label': 'Accept tag' },
	});
	acceptBtn.addEventListener('click', onAccept);

	const rejectBtn = btnGroup.createEl('button', {
		cls: `atw-btn atw-btn-reject${isRejected ? ' atw-btn-active' : ''}`,
		text: '\u2717',
		attr: { 'aria-label': 'Reject tag' },
	});
	rejectBtn.addEventListener('click', onReject);

	return btnGroup;
}
