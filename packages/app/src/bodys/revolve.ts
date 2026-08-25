// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IShape,
    type ISubShape,
    type Line,
    property,
    ReferenceShapeNode,
    Result,
    type ShapeType,
    ShapeTypes,
    serializable,
    serialize,
} from "@chili3d/core";
import { closedProfileToFace } from "./extrude";

export interface RevolveOptions {
    document: IDocument;
    sectionNodeId: string;
    /**
     * Present together with sectionIndex only when the picked section is a
     * sub-shape of the base node's own shape (e.g. a face of an existing
     * solid) rather than the base node's entire shape.
     */
    sectionShapeType?: ShapeType;
    sectionIndex?: number;
    axis: Line;
    angle: number;
}

/**
 * Holds a reference to the base node id (and, for a sub-shape section such
 * as a face of an existing solid, the sub-shape's type + index within it)
 * rather than a baked profile shape. Editing the base node's own parameters
 * recomputes this node. The base node is hidden, not deleted, by the
 * Revolve command, so the reference keeps resolving.
 */
@serializable()
export class RevolvedNode extends ReferenceShapeNode {
    override display(): I18nKeys {
        return "body.revol";
    }

    @serialize()
    get sectionNodeId(): string {
        return this.getPrivateValue("sectionNodeId");
    }

    @serialize()
    get sectionShapeType(): ShapeType | undefined {
        return this.getPrivateValue("sectionShapeType");
    }

    @serialize()
    get sectionIndex(): number | undefined {
        return this.getPrivateValue("sectionIndex");
    }

    @serialize()
    get axis(): Line {
        return this.getPrivateValue("axis");
    }
    set axis(value: Line) {
        this.setPropertyEmitShapeChanged("axis", value);
    }

    @serialize()
    @property("common.angle")
    get angle(): number {
        return this.getPrivateValue("angle");
    }
    set angle(value: number) {
        this.setPropertyEmitShapeChanged("angle", value);
    }

    constructor(options: RevolveOptions) {
        super(options);
        this.setPrivateValue("sectionNodeId", options.sectionNodeId);
        this.setPrivateValue("sectionShapeType", options.sectionShapeType);
        this.setPrivateValue("sectionIndex", options.sectionIndex);
        this.setPrivateValue("axis", options.axis);
        this.setPrivateValue("angle", options.angle);
    }

    override redirectReference(oldId: string, newId: string): boolean {
        if (this.sectionNodeId !== oldId) return false;
        this.setProperty("sectionNodeId", newId);
        this.setShape(this.generateShape());
        return true;
    }

    override get primaryInputId(): string | undefined {
        return this.sectionNodeId;
    }

    /**
     * The base node's own shape, or - when sectionIndex is set - the
     * sub-shape at that index within it. See ExtrudeNode.resolveSection for
     * the same indexing scheme (positions into the base shape's own
     * findSubShapes() list for sectionShapeType).
     */
    private resolveSection(base: IShape): Result<IShape> {
        if (this.sectionIndex === undefined || this.sectionShapeType === undefined) {
            return Result.ok(base);
        }
        const sub = base.findSubShapes(this.sectionShapeType)[this.sectionIndex] as ISubShape | undefined;
        if (!sub) {
            return Result.err(`Revolve: section index ${this.sectionIndex} no longer exists`);
        }
        return Result.ok(sub);
    }

    override generateShape(): Result<IShape> {
        const base = this.resolveInput(this.sectionNodeId);
        if (!base) return Result.err(`Revolve: section shape "${this.sectionNodeId}" no longer exists`);
        if (!base.shape.isOk) return Result.err(base.shape.error);

        this.subscribeTo([base]);

        const sectionResult = this.resolveSection(base.shape.value.transformedMul(base.transform));
        if (!sectionResult.isOk) return sectionResult;
        const profile = sectionResult.value;

        if (
            (profile.shapeType === ShapeTypes.wire || profile.shapeType === ShapeTypes.edge) &&
            profile.isClosed()
        ) {
            // Revolving a closed profile (wire or circle edge) as a face produces a solid instead of a shell.
            const face = closedProfileToFace(profile);
            if (!face.isOk) return Result.err(face.error);
            return shapeFactory.revolve(face.value, this.axis, this.angle);
        }
        return shapeFactory.revolve(profile, this.axis, this.angle);
    }
}
