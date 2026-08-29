// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CurveUtils,
    command,
    type GeometryNode,
    type IEdge,
    type ILine,
    type IShape,
    type IShapeFilter,
    type IStep,
    Line,
    property,
    SelectShapeStep,
    type ShapeNode,
    type ShapeType,
    ShapeTypes,
    spliceIntoReferenceChain,
    VisualStates,
} from "@chili3d/core";
import { RevolvedNode, sectionRefFromPick } from "../../bodys";
import { CreateFromSelectionCommand, selectedWholeShapeNodes } from "../createCommand";

@command({
    key: "create.revol",
    icon: "icon-revolve",
})
export class Revolve extends CreateFromSelectionCommand {
    private createdNode?: RevolvedNode;

    @property("common.angle")
    public get angle() {
        return this.getPrivateValue("angle", 360);
    }
    public set angle(value: number) {
        this.setProperty("angle", value);
    }

    protected override geometryNode(): GeometryNode {
        const pick = this.stepDatas[0].shapes[0];
        const edge = (this.stepDatas[1].shapes[0].shape as IEdge).curve.basisCurve as ILine;
        const transform = this.stepDatas[1].shapes[0].transform;
        const axis = new Line({
            point: transform.ofPoint(edge.value(0)),
            direction: transform.ofVector(edge.direction),
        });

        const { shapeType, index } = sectionRefFromPick(pick.owner.node as ShapeNode, pick.shape);
        const node = new RevolvedNode({
            document: this.document,
            sectionNodeId: (pick.owner.node as ShapeNode).id,
            sectionShapeType: shapeType,
            sectionIndex: index,
            axis,
            angle: this.angle,
        });
        this.createdNode = node;
        return node;
    }

    /**
     * Hide rather than delete the source node(s) (the section, and - when
     * it's a standalone construction line - the axis) - RevolvedNode keeps a
     * live reference to whichever node its section was picked from, so
     * deleting it would break that reference. Sub-shape picks (a face of an
     * existing solid) are excluded by selectedWholeShapeNodes, so that solid
     * stays visible.
     */
    protected override afterNodeCreated(): void {
        if (this.deleteObjects) {
            selectedWholeShapeNodes(this.stepDatas).forEach((node) => {
                node.visible = false;
                if (this.createdNode) spliceIntoReferenceChain(this.document, node, this.createdNode);
            });
        }
        this.repositionAfterSection();
    }

    /**
     * The new Revolve was appended to the tree by the shared CreateCommand
     * flow before afterNodeCreated ran. Move it to sit right after its
     * section node instead, so it lands at its logical spot in the
     * tree/timeline rather than always at the end.
     */
    private repositionAfterSection(): void {
        const createdNode = this.createdNode;
        if (!createdNode?.parent) return;
        const section = this.document.modelManager.findNode((n) => n.id === createdNode.sectionNodeId);
        if (!section?.parent) return;
        createdNode.parent.move(createdNode, section.parent, section);
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(
                (ShapeTypes.edge | ShapeTypes.face | ShapeTypes.wire) as ShapeType,
                "prompt.select.section",
            ),
            new SelectShapeStep(ShapeTypes.edge, "prompt.select.axis", {
                shapeFilter: new LineFilter(),
                beforeSelection: () => this.addFirstSelectedState(VisualStates.edgeSelected),
                afterSelection: () => this.removeFirstSelectedState(VisualStates.edgeSelected),
            }),
        ];
    }
}

export class LineFilter implements IShapeFilter {
    allow(shape: IShape): boolean {
        if (shape.shapeType === ShapeTypes.edge) {
            const edge = shape as IEdge;
            const curve = edge.curve.basisCurve;
            return CurveUtils.isLine(curve);
        }
        return false;
    }
}
