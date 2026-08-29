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
    VisualStates,
} from "@chili3d/core";
import { SweepedNode, sweepRefFromPick } from "../../bodys";
import { KeepExistingSelectionStep } from "./keepExistingSelectionStep";

/**
 * Re-picks the path and/or profile selection of an existing SweepedNode,
 * updating it in place instead of creating a new feature - so anything
 * downstream that references it keeps working. Operates on the node
 * currently selected in the tree/timeline; invoked by double-clicking that
 * entry. round has no independent editing route on the node itself (like
 * Sweep's own property at creation time), so it's exposed here instead,
 * defaulting to the target's current value.
 */
@command({
    key: "modify.sweepEdit",
    icon: "icon-sweep",
})
export class SweepEditCommand extends MultistepCommand {
    private targetNode?: SweepedNode;

    @property("option.command.isRoundCorner")
    get round() {
        return this.getPrivateValue("round", this.targetNode?.round ?? false);
    }
    set round(value: boolean) {
        this.setProperty("round", value);
    }

    protected override async canExcute(): Promise<boolean> {
        const node = this.document.selection
            .getSelectedNodes()
            .find((n): n is SweepedNode => n instanceof SweepedNode);
        if (!node) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return false;
        }
        this.targetNode = node;
        this.round = node.round;
        return true;
    }

    protected override getSteps() {
        return [
            new KeepExistingSelectionStep(
                (ShapeTypes.edge | ShapeTypes.wire) as ShapeType,
                "prompt.select.path",
            ),
            new KeepExistingSelectionStep(
                (ShapeTypes.edge | ShapeTypes.wire) as ShapeType,
                "prompt.select.section",
                {
                    multiple: true,
                    beforeSelection: () => this.addFirstSelectedState(VisualStates.edgeSelected),
                    afterSelection: () => this.removeFirstSelectedState(VisualStates.edgeSelected),
                },
            ),
        ];
    }

    protected override executeMainTask() {
        const node = this.targetNode;
        if (!node) return;

        const pathPick = this.stepDatas[0].shapes[0];
        const profilePicks = this.stepDatas[1].shapes;

        Transaction.execute(this.document, `edit ${node.name}`, () => {
            const pathRef = pathPick
                ? sweepRefFromPick(pathPick.owner.node as ShapeNode, pathPick.shape)
                : { nodeId: node.pathNodeId, shapeType: node.pathShapeType, index: node.pathIndex };
            const profileRefs =
                profilePicks.length > 0
                    ? profilePicks.map((p) => sweepRefFromPick(p.owner.node as ShapeNode, p.shape))
                    : node.profileNodeIds.map((nodeId, i) => ({
                          nodeId,
                          shapeType: node.profileShapeTypes[i],
                          index: node.profileIndexes[i],
                      }));

            node.updateSelection(profileRefs, pathRef, this.round);
        });

        this.document.visual.update();
    }
}
