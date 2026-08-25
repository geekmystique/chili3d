// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    type GeometryNode,
    type IStep,
    property,
    SelectShapeStep,
    type ShapeNode,
    type ShapeType,
    ShapeTypes,
    spliceIntoReferenceChain,
    VisualStates,
} from "@chili3d/core";
import { SweepedNode, sweepRefFromPick } from "../../bodys";
import { CreateFromSelectionCommand, selectedWholeShapeNodes } from "../createCommand";

@command({
    key: "create.sweep",
    icon: "icon-sweep",
})
export class Sweep extends CreateFromSelectionCommand {
    private createdNode?: SweepedNode;

    @property("option.command.isRoundCorner")
    get round() {
        return this.getPrivateValue("round", false);
    }

    set round(value: boolean) {
        this.setProperty("round", value);
    }

    protected override geometryNode(): GeometryNode {
        const pathPick = this.stepDatas[0].shapes[0];
        const pathRef = sweepRefFromPick((pathPick.owner.node as ShapeNode).id, pathPick.shape);

        const profileRefs = this.stepDatas[1].shapes.map((pick) =>
            sweepRefFromPick((pick.owner.node as ShapeNode).id, pick.shape),
        );

        const node = new SweepedNode({
            document: this.document,
            profileNodeIds: profileRefs.map((r) => r.nodeId),
            profileShapeTypes: profileRefs.map((r) => r.shapeType),
            profileIndexes: profileRefs.map((r) => r.index),
            pathNodeId: pathRef.nodeId,
            pathShapeType: pathRef.shapeType,
            pathIndex: pathRef.index,
            round: this.round,
        });
        this.createdNode = node;
        return node;
    }

    /**
     * Hide rather than delete the source node(s) - SweepedNode keeps a live
     * reference to whichever nodes its path and profiles were picked from,
     * so deleting them would break those references. Sub-shape picks (an
     * edge of an existing solid) are excluded by selectedWholeShapeNodes, so
     * that solid stays visible.
     */
    protected override afterNodeCreated(): void {
        if (this.deleteObjects) {
            selectedWholeShapeNodes(this.stepDatas).forEach((node) => {
                node.visible = false;
                if (this.createdNode) spliceIntoReferenceChain(this.document, node, this.createdNode);
            });
        }
        this.repositionAfterPath();
    }

    /**
     * The new Sweep was appended to the tree by the shared CreateCommand
     * flow before afterNodeCreated ran. Move it to sit right after its path
     * node instead, so it lands at its logical spot in the tree/timeline
     * rather than always at the end.
     */
    private repositionAfterPath(): void {
        const createdNode = this.createdNode;
        if (!createdNode?.parent) return;
        const path = this.document.modelManager.findNode((n) => n.id === createdNode.pathNodeId);
        if (!path?.parent) return;
        createdNode.parent.move(createdNode, path.parent, path);
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep((ShapeTypes.edge | ShapeTypes.wire) as ShapeType, "prompt.select.path"),
            new SelectShapeStep((ShapeTypes.edge | ShapeTypes.wire) as ShapeType, "prompt.select.section", {
                multiple: true,
                beforeSelection: () => this.addFirstSelectedState(VisualStates.edgeSelected),
                afterSelection: () => this.removeFirstSelectedState(VisualStates.edgeSelected),
            }),
        ];
    }
}
