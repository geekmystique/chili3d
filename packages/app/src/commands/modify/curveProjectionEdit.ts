// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    MultistepCommand,
    PubSub,
    type ShapeNode,
    type ShapeType,
    ShapeTypes,
    Transaction,
    VisualStates,
} from "@chili3d/core";
import { CurveProjectionNode, sweepRefFromPick } from "../../bodys";
import { KeepExistingSelectionStep } from "./keepExistingSelectionStep";

/**
 * Re-picks the curve and/or target-face reference of an existing
 * CurveProjectionNode, updating it in place instead of creating a new
 * feature - so anything downstream that references it keeps working.
 * Operates on the node currently selected in the tree/timeline; invoked by
 * double-clicking that entry. dir stays independently editable through the
 * node's own Properties panel, so it isn't touched here.
 */
@command({
    key: "modify.curveProjectionEdit",
    icon: "icon-curveProject",
})
export class CurveProjectionEditCommand extends MultistepCommand {
    private targetNode?: CurveProjectionNode;

    protected override async canExcute(): Promise<boolean> {
        const node = this.document.selection
            .getSelectedNodes()
            .find((n): n is CurveProjectionNode => n instanceof CurveProjectionNode);
        if (!node) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return false;
        }
        this.targetNode = node;
        return true;
    }

    protected override getSteps() {
        return [
            new KeepExistingSelectionStep(
                (ShapeTypes.edge | ShapeTypes.wire) as ShapeType,
                "prompt.select.shape",
            ),
            new KeepExistingSelectionStep(ShapeTypes.face, "prompt.select.faces", {
                beforeSelection: () => this.addFirstSelectedState(VisualStates.edgeSelected),
                afterSelection: () => this.removeFirstSelectedState(VisualStates.edgeSelected),
            }),
        ];
    }

    protected override executeMainTask() {
        const node = this.targetNode;
        if (!node) return;

        const shapePick = this.stepDatas[0].shapes[0];
        const facePick = this.stepDatas[1].shapes[0];

        Transaction.execute(this.document, `edit ${node.name}`, () => {
            const shapeRef = shapePick
                ? sweepRefFromPick(shapePick.owner.node as ShapeNode, shapePick.shape)
                : { nodeId: node.shapeNodeId, shapeType: node.shapeShapeType, index: node.shapeIndex };
            const faceRef = facePick
                ? sweepRefFromPick(facePick.owner.node as ShapeNode, facePick.shape)
                : { nodeId: node.faceNodeId, shapeType: node.faceShapeType, index: node.faceIndex };

            node.updateReferences(shapeRef, faceRef);
        });

        this.document.visual.update();
    }
}
