// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    type IEdge,
    type ILine,
    type ISubShape,
    Line,
    MultistepCommand,
    PubSub,
    type ShapeNode,
    type ShapeType,
    ShapeTypes,
    Transaction,
    type VisualShapeData,
    VisualStates,
} from "@chili3d/core";
import { RevolvedNode } from "../../bodys/revolve";
import { LineFilter } from "../create/revolve";
import { KeepExistingSelectionStep } from "./keepExistingSelectionStep";

/**
 * Re-picks the section (and/or sub-shape within it) and/or the axis of an
 * existing RevolvedNode, updating it in place instead of creating a new
 * feature - so anything downstream that references it keeps working.
 * Operates on the node currently selected in the tree/timeline; invoked by
 * double-clicking that entry. angle stays independently editable through
 * the node's own Properties panel, so it isn't touched here.
 */
@command({
    key: "modify.revolveEdit",
    icon: "icon-revolve",
})
export class RevolveEditCommand extends MultistepCommand {
    private targetNode?: RevolvedNode;

    protected override async canExcute(): Promise<boolean> {
        const node = this.document.selection
            .getSelectedNodes()
            .find((n): n is RevolvedNode => n instanceof RevolvedNode);
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
                (ShapeTypes.edge | ShapeTypes.face | ShapeTypes.wire) as ShapeType,
                "prompt.select.section",
            ),
            new KeepExistingSelectionStep(ShapeTypes.edge, "prompt.select.axis", {
                shapeFilter: new LineFilter(),
                beforeSelection: () => this.addFirstSelectedState(VisualStates.edgeSelected),
                afterSelection: () => this.removeFirstSelectedState(VisualStates.edgeSelected),
            }),
        ];
    }

    protected override executeMainTask() {
        const node = this.targetNode;
        if (!node) return;

        const sectionPick = this.stepDatas[0].shapes[0];
        const axisPick = this.stepDatas[1].shapes[0];

        Transaction.execute(this.document, `edit ${node.name}`, () => {
            const [nodeId, shapeType, index] = sectionPick
                ? this.sectionRef(sectionPick)
                : ([node.sectionNodeId, node.sectionShapeType, node.sectionIndex] as const);

            const axis = axisPick ? this.axisFromPick(axisPick) : node.axis;

            node.updateSection(nodeId, shapeType, index, axis);
        });

        if (!node.shape.isOk) {
            PubSub.default.pub("displayError", node.shape.error);
        }
        this.document.visual.update();
    }

    private sectionRef(pick: VisualShapeData) {
        const sub = pick.shape as Partial<ISubShape>;
        return [
            (pick.owner.node as ShapeNode).id,
            sub.index !== undefined ? pick.shape.shapeType : undefined,
            sub.index,
        ] as const;
    }

    private axisFromPick(pick: VisualShapeData): Line {
        const edge = (pick.shape as IEdge).curve.basisCurve as ILine;
        const transform = pick.transform;
        return new Line({
            point: transform.ofPoint(edge.value(0)),
            direction: transform.ofVector(edge.direction),
        });
    }
}
