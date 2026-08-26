// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, GeometryNode, PubSub, Transaction } from "@chili3d/core";
import { PlacementNode } from "../../bodys/placement";
import { Move } from "./move";

/**
 * Re-drags the move offset of an existing PlacementNode created by Move,
 * updating it in place instead of creating a new feature - so anything
 * downstream that references it keeps working. Operates on the node
 * currently selected in the tree/timeline; invoked by double-clicking that
 * entry. Reuses Move's own step flow and transform computation entirely -
 * only canExcute (find the target instead of the current selection) and
 * executeMainTask (update the target instead of creating a new node) differ.
 */
@command({
    key: "modify.placementMoveEdit",
    icon: "icon-move",
})
export class PlacementMoveEditCommand extends Move {
    private targetNode?: PlacementNode;

    protected override async canExcute(): Promise<boolean> {
        const node = this.document.selection
            .getSelectedNodes()
            .find((n): n is PlacementNode => n instanceof PlacementNode);
        const base = node && this.document.modelManager.findNode((n) => n.id === node.baseNodeId);
        if (!node || !(base instanceof GeometryNode)) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return false;
        }

        this.targetNode = node;
        this.models = [base];
        this.positions = base.mesh.edges?.position ? base.transform.ofPoints(base.mesh.edges.position) : [];
        return true;
    }

    protected override executeMainTask(): void {
        const node = this.targetNode;
        if (!node) return;

        const transform = this.transfrom(this.stepDatas.at(-1)!.point!);

        Transaction.execute(this.document, `edit ${node.name}`, () => {
            node.updateDelta(transform);
        });

        if (!node.shape.isOk) {
            PubSub.default.pub("displayError", node.shape.error);
        }
        this.document.visual.update();
    }
}
