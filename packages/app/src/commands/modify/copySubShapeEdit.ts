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
} from "@chili3d/core";
import { CopySubShapeNode, sweepRefFromPick } from "../../bodys";
import { KeepExistingSelectionStep } from "./keepExistingSelectionStep";

/**
 * Re-picks the copied sub-shape of an existing CopySubShapeNode, updating it
 * in place instead of creating a new feature - so anything downstream that
 * references it keeps working. Operates on the node currently selected in
 * the tree/timeline; invoked by double-clicking that entry.
 */
@command({
    key: "modify.copySubShapeEdit",
    icon: "icon-subShape",
})
export class CopySubShapeEditCommand extends MultistepCommand {
    private targetNode?: CopySubShapeNode;

    protected override async canExcute(): Promise<boolean> {
        const node = this.document.selection
            .getSelectedNodes()
            .find((n): n is CopySubShapeNode => n instanceof CopySubShapeNode);
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
                (ShapeTypes.edge | ShapeTypes.face) as ShapeType,
                "prompt.select.shape",
            ),
        ];
    }

    protected override executeMainTask() {
        const node = this.targetNode;
        if (!node) return;

        const pick = this.stepDatas[0].shapes[0];

        Transaction.execute(this.document, `edit ${node.name}`, () => {
            if (pick) {
                const ref = sweepRefFromPick(pick.owner.node as ShapeNode, pick.shape);
                node.updateSelection(ref.nodeId, ref.shapeType, ref.index);
            } else {
                node.updateSelection(node.sourceNodeId, node.subShapeType, node.index);
            }
        });

        if (!node.shape.isOk) {
            PubSub.default.pub("displayError", node.shape.error);
        }
        this.document.visual.update();
    }
}
