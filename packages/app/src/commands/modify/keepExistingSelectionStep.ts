// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type I18nKeys,
    type IDocument,
    type SelectNodeOptions,
    SelectNodeStep,
    type SelectShapeOptions,
    SelectShapeStep,
    type ShapeType,
    type SnapResult,
} from "@chili3d/core";

/**
 * SelectShapeStep treats a confirm with nothing picked as a failed step,
 * which aborts the whole command before executeMainTask ever runs - correct
 * for a fresh create command (nothing to apply the operation to), wrong for
 * re-editing an existing feature: confirming without touching the 3D view
 * should keep the feature's current reference(s), not silently drop the
 * whole edit. This resolves to an empty (not undefined) SnapResult instead,
 * so the step always succeeds; the edit command's executeMainTask falls back
 * to the target's existing reference(s) whenever nothing was (re-)picked.
 *
 * Always requests the confirm/cancel control (regardless of `multiple`):
 * confirming without (re-)picking is a normal, expected outcome here, and for
 * a single-pick step that's otherwise the only way to finish without picking
 * something - doubly so when the edit command also exposes another property
 * (a length, say) that needs its own explicit "I'm done" action.
 */
export class KeepExistingSelectionStep extends SelectShapeStep {
    constructor(shapeType: ShapeType, prompt: I18nKeys, options?: SelectShapeOptions) {
        super(shapeType, prompt, { ...options, showControl: true });
    }

    override async select(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        const result = await super.select(document, controller);
        if (result) return result;
        return { view: document.application.activeView!, shapes: [], nodes: [], type: "shape" };
    }
}

/** The SelectNodeStep counterpart of KeepExistingSelectionStep, for edit commands that re-pick whole nodes. */
export class KeepExistingNodeSelectionStep extends SelectNodeStep {
    constructor(prompt: I18nKeys, options?: SelectNodeOptions) {
        super(prompt, { ...options, showControl: true });
    }

    override async execute(
        document: IDocument,
        controller: AsyncController,
    ): Promise<SnapResult | undefined> {
        const result = await super.execute(document, controller);
        if (result) return result;
        return { view: document.application.activeView!, shapes: [], nodes: [], type: "node" };
    }
}
