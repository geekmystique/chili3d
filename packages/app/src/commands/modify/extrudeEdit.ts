// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    MultistepCommand,
    PubSub,
    property,
    type ShapeNode,
    type ShapeType,
    ShapeTypes,
    Transaction,
} from "@chili3d/core";
import { sectionRefFromPick } from "../../bodys";
import { ExtrudeNode } from "../../bodys/extrude";
import { KeepExistingSelectionStep } from "./keepExistingSelectionStep";

/**
 * Re-picks the section (and/or sub-shape within it) and/or the length of an
 * existing ExtrudeNode, updating it in place instead of creating a new
 * feature - so anything downstream that references it keeps working.
 * Operates on the node currently selected in the tree/timeline; invoked by
 * double-clicking that entry. length already has its own route through the
 * node's Properties panel, but is exposed here too - the same way
 * Fillet/Chamfer's own value is - so it's editable in the same flow as the
 * re-pick, without leaving this command first.
 */
@command({
    key: "modify.extrudeEdit",
    icon: "icon-prism",
})
export class ExtrudeEditCommand extends MultistepCommand {
    private targetNode?: ExtrudeNode;

    @property("common.length")
    get length() {
        return this.getPrivateValue("length", this.targetNode?.length ?? 0);
    }
    set length(value: number) {
        this.setProperty("length", value);
    }

    protected override async canExcute(): Promise<boolean> {
        const node = this.document.selection
            .getSelectedNodes()
            .find((n): n is ExtrudeNode => n instanceof ExtrudeNode);
        if (!node) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return false;
        }
        this.targetNode = node;
        // Through the property setter (not setPrivateValue) so the already-open
        // command context panel's binding picks up the corrected value - it
        // rendered with the pre-canExcute default before this ran.
        this.length = node.length;
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
                node.updateSection((pick.owner.node as ShapeNode).id, shapeType, index, this.length);
            } else {
                node.updateSection(node.sectionNodeId, node.sectionShapeType, node.sectionIndex, this.length);
            }
        });

        this.document.visual.update();
    }
}
