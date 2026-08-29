// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, MultistepCommand, PubSub, ShapeNode, ShapeTypes, Transaction } from "@chili3d/core";
import { BooleanNode } from "../../bodys/boolean";
import { KeepExistingSelectionStep } from "./keepExistingSelectionStep";

/**
 * Re-picks the base and/or tool selection of an existing BooleanNode,
 * updating it in place instead of creating a new feature - so anything
 * downstream that references it keeps working. Operates on the node
 * currently selected in the tree/timeline; invoked by double-clicking that
 * entry. operateType (common/cut/fuse) is fixed to whatever the node already
 * is - switching it is a fundamentally different operation, left for later.
 */
@command({
    key: "modify.booleanEdit",
    icon: "icon-booleanCommon",
})
export class BooleanEditCommand extends MultistepCommand {
    private targetNode?: BooleanNode;

    protected override async canExcute(): Promise<boolean> {
        const node = this.document.selection
            .getSelectedNodes()
            .find((n): n is BooleanNode => n instanceof BooleanNode);
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
                nodeFilter: { allow: (node) => node instanceof ShapeNode },
            }),
            new KeepExistingSelectionStep(ShapeTypes.shape, "prompt.select.shape", {
                nodeFilter: {
                    allow: (node) => {
                        if (!(node instanceof ShapeNode)) return false;
                        return !this.stepDatas[0]?.nodes
                            ?.map((x) => (x as ShapeNode).shape.value)
                            .includes(node.shape.value);
                    },
                },
                multiple: true,
            }),
        ];
    }

    protected override executeMainTask() {
        const node = this.targetNode;
        if (!node) return;

        const basePick = this.stepDatas[0].shapes;
        const toolPicks = this.stepDatas[1].shapes;

        Transaction.execute(this.document, `edit ${node.name}`, () => {
            const baseNodeId =
                basePick.length > 0
                    ? ((this.stepDatas[0].nodes?.[0] as ShapeNode | undefined)?.id ?? node.baseNodeId)
                    : node.baseNodeId;
            const toolNodeIds =
                toolPicks.length > 0
                    ? (this.stepDatas[1].nodes as ShapeNode[]).map((n) => n.id)
                    : node.toolNodeIds;

            node.updateSelection(baseNodeId, toolNodeIds);
        });

        this.document.visual.update();
    }
}
