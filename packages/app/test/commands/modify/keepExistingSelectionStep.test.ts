// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type IDocument,
    SelectNodeStep,
    SelectShapeStep,
    ShapeTypes,
} from "@chili3d/core";
import { describe, expect, rs, test } from "@rstest/core";
import {
    KeepExistingNodeSelectionStep,
    KeepExistingSelectionStep,
} from "../../../src/commands/modify/keepExistingSelectionStep";

describe("KeepExistingSelectionStep", () => {
    test("should force showControl on regardless of what was passed in", () => {
        const step = new KeepExistingSelectionStep(ShapeTypes.edge, "prompt.select.shape", {
            multiple: true,
        });
        expect((step as any).options.showControl).toBe(true);
        expect((step as any).options.multiple).toBe(true);
    });

    test("should force showControl on even with no options at all", () => {
        const step = new KeepExistingSelectionStep(ShapeTypes.edge, "prompt.select.shape");
        expect((step as any).options.showControl).toBe(true);
    });

    test("select() should resolve to an empty (not undefined) result when nothing was picked", async () => {
        const step = new KeepExistingSelectionStep(ShapeTypes.edge, "prompt.select.shape");
        const superSelect = rs.spyOn(SelectShapeStep.prototype, "select").mockResolvedValue(undefined);
        const doc = { application: { activeView: {} } } as unknown as IDocument;

        try {
            const result = await step.select(doc, {} as AsyncController);
            expect(result).toEqual({
                view: doc.application.activeView,
                shapes: [],
                nodes: [],
                type: "shape",
            });
        } finally {
            superSelect.mockRestore();
        }
    });

    test("select() should pass through a real pick unchanged", async () => {
        const step = new KeepExistingSelectionStep(ShapeTypes.edge, "prompt.select.shape");
        const picked = { view: {}, shapes: [{}], nodes: [{}], type: "shape" } as any;
        const superSelect = rs.spyOn(SelectShapeStep.prototype, "select").mockResolvedValue(picked);

        try {
            const result = await step.select({} as IDocument, {} as AsyncController);
            expect(result).toBe(picked);
        } finally {
            superSelect.mockRestore();
        }
    });
});

describe("KeepExistingNodeSelectionStep", () => {
    test("should force showControl on regardless of what was passed in", () => {
        const step = new KeepExistingNodeSelectionStep("prompt.select.shape", { multiple: true });
        expect((step as any).options.showControl).toBe(true);
        expect((step as any).options.multiple).toBe(true);
    });

    test("execute() should resolve to an empty (not undefined) result when nothing was picked", async () => {
        const step = new KeepExistingNodeSelectionStep("prompt.select.shape");
        const superExecute = rs.spyOn(SelectNodeStep.prototype, "execute").mockResolvedValue(undefined);
        const doc = {
            application: { activeView: {} },
            selection: { clearSelection: () => {} },
        } as unknown as IDocument;

        try {
            const result = await step.execute(doc, {} as AsyncController);
            expect(result).toEqual({ view: doc.application.activeView, shapes: [], nodes: [], type: "node" });
        } finally {
            superExecute.mockRestore();
        }
    });
});
