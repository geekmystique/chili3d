// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    GeometryUtils,
    type IEdge,
    type IFace,
    type IShape,
    type IStep,
    type ISubEdgeShape,
    type LengthAtAxisSnapData,
    LengthAtAxisStep,
    Precision,
    property,
    type Result,
    type ShapeMeshData,
    type ShapeNode,
    ShapeTypes,
    SnapEventHandler,
    type VisualShapeData,
    XYZ,
} from "@chili3d/core";
import type { EdgeCornerOperateType } from "../../bodys/edgeCorner";
import { EdgeCornerCommand, faceContaining, isPlanarParent } from "./edgeCornerCommand";

@command({
    key: "modify.fillet",
    icon: "icon-fillet",
})
export class FilletCommand extends EdgeCornerCommand {
    @property("circle.radius")
    get radius() {
        return this.getPrivateValue("radius", 10);
    }

    /**
     * Visible from the start of the command, defaulting to 10 - typing an
     * exact value here applies it and finishes the radius-drag step (see
     * getSteps) immediately, the same pattern as ExtrudeCommand.length. While
     * the step is live-dragging, buildRadiusContext's preview callback keeps
     * this in sync with the pointer via setProperty directly (not through
     * this setter, which would otherwise re-finish the step every move).
     */
    set radius(value: number) {
        const changed = this.setProperty("radius", value);
        if (!changed) return;

        const view = this.document.application.activeView;
        const handler = this.document.visual.eventHandler;
        if (view && handler instanceof SnapEventHandler) {
            handler.applyTypedInput(view, String(value));
        }
    }

    protected override get operateType(): EdgeCornerOperateType {
        return "fillet";
    }

    protected override get cornerValue(): number {
        return this.radius;
    }

    protected override applyToFace(face: IFace, edge1: IEdge, edge2: IEdge): Result<IShape> {
        return shapeFactory.fillet2d(face, edge1, edge2, this.radius);
    }

    protected override applyToEdgePair(edge1: IEdge, edge2: IEdge): Result<IEdge[]> {
        return shapeFactory.filletEdge2d(edge1, edge2, this.radius);
    }

    /** Pick the edges (inherited), then drag to set the radius - the same two-step shape as ExtrudeCommand. */
    protected override getSteps(): IStep[] {
        return [...super.getSteps(), new LengthAtAxisStep("prompt.pickRadius", this.getRadiusStepData, true)];
    }

    private readonly getRadiusStepData = (): LengthAtAxisSnapData => {
        const { point, direction, preview } = this.buildRadiusContext();
        return {
            point,
            direction,
            preview: (p) => {
                if (!p) return [];
                const dist = Math.abs(p.sub(point).dot(direction));
                // Reflect the live drag distance in the properties panel - via
                // setProperty directly, not the radius setter above, which
                // would otherwise re-finish the step on every mouse move.
                this.setProperty("radius", dist);
                if (dist < Precision.Distance) return [];
                return preview();
            },
        };
    };

    /**
     * Where to anchor the radius drag handle, and how to preview the fillet
     * at the current radius - both computed once per finished edge
     * selection (not once per mouse move, unlike the preview mesh itself).
     */
    private buildRadiusContext(): {
        point: XYZ;
        direction: XYZ;
        preview: () => ShapeMeshData[];
    } {
        const shapes = this.stepDatas[0].shapes;
        const parent = (shapes[0].shape as ISubEdgeShape).parent;

        if (!isPlanarParent(parent)) {
            return this.buildSolidRadiusContext(shapes, parent);
        }
        return this.buildCornerRadiusContext(shapes, parent);
    }

    /**
     * One or more edges of a solid/compound: the handle sits at the first
     * edge's midpoint, along its adjacent face's surface (that face's normal
     * crossed with the edge's tangent) - dragging either way along that line
     * grows the radius, like pulling a handle across the face away from the
     * edge. Radius has no direction, so only the drag's magnitude is used;
     * which of the two ways along this line the user actually drags doesn't
     * matter.
     */
    private buildSolidRadiusContext(shapes: VisualShapeData[], parent: IShape) {
        const sub = shapes[0].shape as ISubEdgeShape;
        const edge = sub.transformedMul(shapes[0].transform) as IEdge;
        this.disposeStack.add(edge);

        const mid = (edge.firstParameter() + edge.lastParameter()) / 2;
        const point = edge.curve.value(mid);
        const tangent = edge.curve.d1(mid).vec.normalize() ?? XYZ.unitX;

        // findAncestor needs the original (untransformed) sub-edge/parent pair -
        // it walks the parent's own topology tree to find the face(s) owning it.
        const faces = sub.findAncestor(ShapeTypes.face, parent) as IFace[];
        let normal = XYZ.unitZ;
        if (faces.length > 0) {
            const worldFace = faces[0].transformedMul(shapes[0].transform) as IFace;
            this.disposeStack.add(worldFace);
            normal = GeometryUtils.normal(worldFace);
        }
        const direction = normal.cross(tangent).normalize() ?? this.perpendicularTo(tangent);

        const node = shapes[0].owner.node as ShapeNode;
        const edgeIndexes = shapes.map((x) => (x.shape as ISubEdgeShape).index);
        let baseShape: IShape | undefined;
        if (node.shape.isOk) {
            baseShape = node.shape.value.transformedMul(node.transform);
            this.disposeStack.add(baseShape);
        }

        return {
            point,
            direction,
            preview: (): ShapeMeshData[] => {
                if (!baseShape) return [];
                const result = shapeFactory.fillet(baseShape, edgeIndexes, this.radius);
                if (!result.isOk) return [];
                return [this.meshShape(result.value)];
            },
        };
    }

    /**
     * Exactly two edges meeting at a corner - a face, a wire, or a
     * standalone edge pair (isPlanarParent treats all three the same). The
     * handle sits at the two edges' shared (or nearest) endpoint, along the
     * bisector of their tangents there - dragging either way along that line
     * grows the radius, the same gesture as a 2D sketch fillet.
     */
    private buildCornerRadiusContext(shapes: VisualShapeData[], parent: IShape) {
        const [worldA, worldB] = shapes.map((s) => s.shape.transformedMul(s.transform) as IEdge);
        this.disposeStack.add(worldA);
        this.disposeStack.add(worldB);
        const { point, direction } = this.cornerAxis(worldA, worldB);

        if (parent.shapeType === ShapeTypes.edge) {
            // A standalone edge pair fillets on the transformed edges themselves
            // (see modifyStandaloneEdges), so reuse these same copies.
            return {
                point,
                direction,
                preview: (): ShapeMeshData[] => {
                    const triple = this.applyToEdgePair(worldA, worldB);
                    if (!triple.isOk) return [];
                    return triple.value.map((e) => this.meshShape(e));
                },
            };
        }

        // A face/wire corner fillets on the untransformed picked edges (see
        // computePlanarShape) - the world-space copies above are only used
        // for the drag axis itself.
        const edgeA = shapes[0].shape as IEdge;
        const edgeB = shapes[1].shape as IEdge;
        const face = faceContaining(parent, shapes[0].shape as ISubEdgeShape);

        return {
            point,
            direction,
            preview: (): ShapeMeshData[] => {
                if (face) {
                    const result = this.applyToFace(face, edgeA, edgeB);
                    if (!result.isOk) return [];
                    return [this.meshShape(result.value)];
                }
                const triple = this.applyToEdgePair(edgeA, edgeB);
                if (!triple.isOk) return [];
                return triple.value.map((e) => this.meshShape(e));
            },
        };
    }

    /** The shared/nearest endpoint of two edges, and the bisector of their tangents away from it. */
    private cornerAxis(edgeA: IEdge, edgeB: IEdge): { point: XYZ; direction: XYZ } {
        const [a0, a1] = edgeA.ends();
        const [b0, b1] = edgeB.ends();
        const candidates: [XYZ, XYZ, XYZ, XYZ][] = [
            [a0, a1, b0, b1],
            [a0, a1, b1, b0],
            [a1, a0, b0, b1],
            [a1, a0, b1, b0],
        ];
        let [vertexA, farA, vertexB, farB] = candidates[0];
        let bestDist = vertexA.distanceTo(vertexB);
        for (const candidate of candidates.slice(1)) {
            const dist = candidate[0].distanceTo(candidate[2]);
            if (dist < bestDist) {
                bestDist = dist;
                [vertexA, farA, vertexB, farB] = candidate;
            }
        }

        const point = vertexA.add(vertexB).multiply(0.5);
        const awayA = farA.sub(vertexA).normalize() ?? XYZ.unitX;
        const awayB = farB.sub(vertexB).normalize() ?? XYZ.unitX;
        const bisector = awayA.add(awayB).normalize();
        return { point, direction: bisector ?? this.perpendicularTo(awayA) };
    }

    /** Any unit vector perpendicular to v - used only for the degenerate case where the natural one collapses to zero. */
    private perpendicularTo(v: XYZ): XYZ {
        const helper = Math.abs(v.dot(XYZ.unitZ)) < 0.9 ? XYZ.unitZ : XYZ.unitX;
        return v.cross(helper).normalize() ?? XYZ.unitX;
    }
}
