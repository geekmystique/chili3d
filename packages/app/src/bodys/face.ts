// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandKeys,
    GeometryUtils,
    type I18nKeys,
    type IEdge,
    type IShape,
    type IWire,
    Precision,
    Result,
    ShapeTypes,
    serializable,
    XYZ,
} from "@chili3d/core";
import { SourceListShapeNode } from "./sourceListShapeNode";

/**
 * Holds references to the edge/wire node ids that bound this face, rather
 * than baked edge/wire shapes. Editing a referenced node's own parameters
 * recomputes this node. The referenced nodes are hidden, not deleted, by
 * ConvertToFace, so the references keep resolving.
 */
@serializable()
export class FaceNode extends SourceListShapeNode {
    protected readonly errorLabel = "Face";

    override display(): I18nKeys {
        return "body.face";
    }

    override get editCommandKey(): CommandKeys {
        return "modify.faceEdit";
    }

    private static getWires(shapes: IShape[]): IWire[] {
        const wires: IWire[] = [];
        const edges: IEdge[] = [];
        for (const shape of shapes) {
            if (shape.shapeType === ShapeTypes.wire) {
                if (shape.isClosed()) {
                    wires.push(shape as IWire);
                } else {
                    edges.push(...(shape.findSubShapes(ShapeTypes.edge) as IEdge[]));
                }
            } else {
                edges.push(shape as IEdge);
            }
        }

        // Edges may form several disjoint loops (e.g. an inner loop offset from an
        // outer one), so build one wire per connected group instead of forcing all
        // edges into a single wire.
        for (const group of FaceNode.groupConnectedEdges(edges)) {
            const wire = shapeFactory.wire(group);
            if (!wire.isOk) throw new Error("Cannot create wire from open shapes");
            wires.push(wire.value);
        }

        return wires;
    }

    private static groupConnectedEdges(edges: IEdge[]): IEdge[][] {
        const remaining = edges.map((edge) => ({ edge, points: FaceNode.endpoints(edge) }));
        const groups: IEdge[][] = [];
        let first = remaining.pop();
        while (first !== undefined) {
            const group = [first];
            let merged = true;
            while (merged) {
                merged = false;
                for (let i = remaining.length - 1; i >= 0; i--) {
                    if (group.some((x) => FaceNode.isTouching(x.points, remaining[i].points))) {
                        group.push(remaining.splice(i, 1)[0]);
                        merged = true;
                    }
                }
            }
            groups.push(group.map((x) => x.edge));
            first = remaining.pop();
        }
        return groups;
    }

    private static endpoints(edge: IEdge): XYZ[] {
        const curve = edge.curve;
        return [curve.value(curve.firstParameter()), curve.value(curve.lastParameter())];
    }

    private static isTouching(a: XYZ[], b: XYZ[]): boolean {
        return a.some((p1) => b.some((p2) => p1.distanceTo(p2) < Precision.Distance));
    }

    protected override combineShapes(shapes: IShape[]): Result<IShape> {
        if (shapes.length === 0) return Result.err("No shapes to create face");

        const wires = FaceNode.getWires(shapes);
        FaceNode.orientOuterWire(wires[0]);
        return shapeFactory.face(wires);
    }

    // Orients the outer wire so the face normal points along the positive dominant axis
    // (e.g. +Z for a face in the XY plane), independent of the drawing direction.
    private static orientOuterWire(wire: IWire): void {
        const normal = GeometryUtils.normal(wire);
        const ax = Math.abs(normal.x);
        const ay = Math.abs(normal.y);
        const az = Math.abs(normal.z);
        const dominant = az >= ax && az >= ay ? XYZ.unitZ : ay >= ax ? XYZ.unitY : XYZ.unitX;
        if (normal.dot(dominant) < 0) {
            wire.reserve();
        }
    }
}
