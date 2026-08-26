// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type IDocument,
    SelectNodeStep,
    SelectShapeStep,
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
 */
export class KeepExistingSelectionStep extends SelectShapeStep {
    override async select(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        const result = await super.select(document, controller);
        if (result) return result;
        return { view: document.application.activeView!, shapes: [], nodes: [], type: "shape" };
    }
}

/** The SelectNodeStep counterpart of KeepExistingSelectionStep, for edit commands that re-pick whole nodes. */
export class KeepExistingNodeSelectionStep extends SelectNodeStep {
    override async execute(
        document: IDocument,
        controller: AsyncController,
    ): Promise<SnapResult | undefined> {
        const result = await super.execute(document, controller);
        if (result) return result;
        return { view: document.application.activeView!, shapes: [], nodes: [], type: "node" };
    }
}
