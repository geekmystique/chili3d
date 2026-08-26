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
import { sectionRefFromPick } from "../../bodys";
import { ExtrudeNode } from "../../bodys/extrude";
import { KeepExistingSelectionStep } from "./keepExistingSelectionStep";

/**
 * Re-picks the section (and/or sub-shape within it) of an existing
 * ExtrudeNode, updating it in place instead of creating a new feature - so
 * anything downstream that references it keeps working. Operates on the
 * node currently selected in the tree/timeline; invoked by double-clicking
 * that entry. length stays independently editable through the node's own
 * Properties panel, so it isn't touched here.
 */
@command({
    key: "modify.extrudeEdit",
    icon: "icon-prism",
})
export class ExtrudeEditCommand extends MultistepCommand {
    private targetNode?: ExtrudeNode;

    protected override async canExcute(): Promise<boolean> {
        const node = this.document.selection
            .getSelectedNodes()
            .find((n): n is ExtrudeNode => n instanceof ExtrudeNode);
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
                (ShapeTypes.face | ShapeTypes.edge | ShapeTypes.wire) as ShapeType,
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
                const { shapeType, index } = sectionRefFromPick(pick.owner.node as ShapeNode, pick.shape);
                node.updateSection((pick.owner.node as ShapeNode).id, shapeType, index);
            } else {
                node.updateSection(node.sectionNodeId, node.sectionShapeType, node.sectionIndex);
            }
        });

        this.document.visual.update();
    }
}
