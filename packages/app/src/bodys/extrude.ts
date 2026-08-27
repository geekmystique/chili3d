// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandKeys,
    GeometryUtils,
    type I18nKeys,
    type IDocument,
    type IEdge,
    type IFace,
    type IShape,
    type ISubShape,
    type IWire,
    property,
    ReferenceShapeNode,
    Result,
    type ShapeType,
    ShapeTypes,
    serializable,
    serialize,
} from "@chili3d/core";

export interface ExtrudeOptions {
    document: IDocument;
    sectionNodeId: string;
    /**
     * Present together with sectionIndex only when the picked section is a
     * sub-shape of the base node's own shape (e.g. a face of an existing
     * solid) rather than the base node's entire shape.
     */
    sectionShapeType?: ShapeType;
    sectionIndex?: number;
    length: number;
}

/**
 * Convert a closed profile to a face. A wire is used directly; a closed edge
 * (e.g. a circle) is first built into a wire.
 */
export function closedProfileToFace(section: IShape): Result<IFace> {
    if (section.shapeType === ShapeTypes.wire) {
        return shapeFactory.face([section as IWire]);
    }
    const wire = shapeFactory.wire([section as IEdge]);
    if (!wire.isOk) return Result.err(wire.error);
    return shapeFactory.face([wire.value]);
}

/**
 * Holds a reference to the base node id (and, for a sub-shape section such
 * as a face of an existing solid, the sub-shape's type + index within it)
 * rather than a baked section shape. Editing the base node's own parameters
 * recomputes this node. The base node is hidden, not deleted, by
 * ExtrudeCommand, so the reference keeps resolving.
 */
@serializable()
export class ExtrudeNode extends ReferenceShapeNode {
    override display(): I18nKeys {
        return "body.extrude";
    }

    override get editCommandKey(): CommandKeys {
        return "modify.extrudeEdit";
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
    @property("common.length")
    get length(): number {
        return this.getPrivateValue("length");
    }
    set length(value: number) {
        this.setPropertyEmitShapeChanged("length", value);
    }

    constructor(options: ExtrudeOptions) {
        super(options);
        this.setPrivateValue("sectionNodeId", options.sectionNodeId);
        this.setPrivateValue("sectionShapeType", options.sectionShapeType);
        this.setPrivateValue("sectionIndex", options.sectionIndex);
        this.setPrivateValue("length", options.length);
    }

    override redirectReference(oldId: string, newId: string): boolean {
        if (this.sectionNodeId !== oldId) return false;
        this.setProperty("sectionNodeId", newId);
        this.setShape(this.generateShape());
        return true;
    }

    /**
     * Re-point this feature at a new section (and/or sub-shape within it)
     * and/or length, and recompute once. Used by the "re-pick" edit flow to
     * redirect an existing feature without deleting and recreating it (which
     * would break anything downstream that references it).
     */
    updateSection(
        nodeId: string,
        shapeType: ShapeType | undefined,
        index: number | undefined,
        length: number,
    ) {
        this.setProperty("sectionNodeId", nodeId);
        this.setProperty("sectionShapeType", shapeType);
        this.setProperty("sectionIndex", index);
        this.setProperty("length", length);
        this.setShape(this.generateShape());
    }

    override get primaryInputId(): string | undefined {
        return this.sectionNodeId;
    }

    /**
     * The base node's own shape, or - when sectionIndex is set - the
     * sub-shape at that index within it. Sub-shape indexes are positions
     * into the base shape's own findSubShapes() list for sectionShapeType,
     * the same indexing scheme edge/face picking already relies on
     * (EdgeCornerNode's edgeIndexes) - not a stable topological identity, so
     * a change that reorders or removes sub-shapes can point this at the
     * wrong one or fail outright.
     */
    private resolveSection(base: IShape): Result<IShape> {
        if (this.sectionIndex === undefined || this.sectionShapeType === undefined) {
            return Result.ok(base);
        }
        const sub = base.findSubShapes(this.sectionShapeType)[this.sectionIndex] as ISubShape | undefined;
        if (!sub) {
            return Result.err(`Extrude: section index ${this.sectionIndex} no longer exists`);
        }
        return Result.ok(sub);
    }

    override generateShape(): Result<IShape> {
        const base = this.resolveInput(this.sectionNodeId);
        if (!base) return Result.err(`Extrude: section shape "${this.sectionNodeId}" no longer exists`);
        if (!base.shape.isOk) return Result.err(base.shape.error);

        this.subscribeTo([base]);

        const sectionResult = this.resolveSection(base.shape.value.transformedMul(base.transform));
        if (!sectionResult.isOk) return sectionResult;
        const section = sectionResult.value;

        const normal = GeometryUtils.normal(section as any);
        const vec = normal.multiply(this.length);
        if (section.shapeType === ShapeTypes.face) {
            const sur = (section as IFace).surface();
            if (!sur.isPlanar()) {
                return shapeFactory.makeThickSolidBySimple(section, this.length);
            }
        } else if (
            (section.shapeType === ShapeTypes.wire || section.shapeType === ShapeTypes.edge) &&
            section.isClosed()
        ) {
            // Extruding a closed profile (wire or circle edge) as a face produces a solid instead of a shell.
            const face = closedProfileToFace(section);
            if (!face.isOk) return Result.err(face.error);
            return shapeFactory.prism(face.value, vec);
        }
        return shapeFactory.prism(section, vec);
    }
}
