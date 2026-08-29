// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    MultistepCommand,
    PubSub,
    type ShapeNode,
    ShapeTypes,
    Transaction,
    VisualStates,
} from "@chili3d/core";
import { SectionNode, sweepRefFromPick } from "../../bodys";
import { KeepExistingSelectionStep } from "./keepExistingSelectionStep";

/**
 * Re-picks the shape and/or path reference of an existing SectionNode,
 * updating it in place instead of creating a new feature - so anything
 * downstream that references it keeps working. Operates on the node
 * currently selected in the tree/timeline; invoked by double-clicking that
 * entry.
 */
@command({
    key: "modify.sectionEdit",
    icon: "icon-section",
})
export class SectionEditCommand extends MultistepCommand {
    private targetNode?: SectionNode;

    protected override async canExcute(): Promise<boolean> {
        const node = this.document.selection
            .getSelectedNodes()
            .find((n): n is SectionNode => n instanceof SectionNode);
        if (!node) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return false;
        }
        this.targetNode = node;
        return true;
    }

    protected override getSteps() {
        return [
            new KeepExistingSelectionStep(ShapeTypes.shape, "prompt.select.shape", {
                selectedState: VisualStates.faceTransparent,
            }),
            new KeepExistingSelectionStep(ShapeTypes.shape, "prompt.select.shape", {
                beforeSelection: () => this.addFirstSelectedState(VisualStates.faceTransparent),
                afterSelection: () => this.removeFirstSelectedState(VisualStates.faceTransparent),
            }),
        ];
    }

    protected override executeMainTask() {
        const node = this.targetNode;
        if (!node) return;

        const shapePick = this.stepDatas[0].shapes[0];
        const pathPick = this.stepDatas[1].shapes[0];

        Transaction.execute(this.document, `edit ${node.name}`, () => {
            const shapeRef = shapePick
                ? sweepRefFromPick(shapePick.owner.node as ShapeNode, shapePick.shape)
                : { nodeId: node.shapeNodeId, shapeType: node.shapeShapeType, index: node.shapeIndex };
            const pathRef = pathPick
                ? sweepRefFromPick(pathPick.owner.node as ShapeNode, pathPick.shape)
                : { nodeId: node.pathNodeId, shapeType: node.pathShapeType, index: node.pathIndex };

            node.updateReferences(shapeRef, pathRef);
        });

        this.document.visual.update();
    }
}
