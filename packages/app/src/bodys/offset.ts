// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandKeys,
    type I18nKeys,
    type IDocument,
    type IEdge,
    type IFace,
    type IShape,
    type IWire,
    type JoinType,
    property,
    ReferenceShapeNode,
    Result,
    type ShapeType,
    ShapeTypes,
    serializable,
    serialize,
    type XYZ,
} from "@chili3d/core";
import { resolveSweepRefShape, type SweepRef } from "./sweep";

export interface OffsetOptions {
    document: IDocument;
    sectionNodeId: string;
    /**
     * Present together with sectionIndex only when the picked section is a
     * sub-shape of the base node's own shape (e.g. a face of an existing
     * solid) rather than the base node's entire shape.
     */
    sectionShapeType?: ShapeType;
    sectionIndex?: number;
    distance: number;
    /** The offset direction for an edge section - unused for a wire/face section (those use joinType instead). */
    normal: XYZ;
    joinType: JoinType;
}

/**
 * Holds a reference to the base node id (and, for a sub-shape section such
 * as a face of an existing solid, the sub-shape's type + index within it)
 * rather than a baked section shape. Editing the base node's own parameters
 * recomputes this node. The base node is left visible - OffsetCommand does
 * not hide it, the offset result sits alongside it, not in place of it.
 */
@serializable()
export class OffsetNode extends ReferenceShapeNode {
    override display(): I18nKeys {
        return "body.offset";
    }

    override get editCommandKey(): CommandKeys {
        return "modify.offsetEdit";
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
    get distance(): number {
        return this.getPrivateValue("distance");
    }
    set distance(value: number) {
        this.setPropertyEmitShapeChanged("distance", value);
    }

    @serialize()
    get normal(): XYZ {
        return this.getPrivateValue("normal");
    }

    @serialize()
    get joinType(): JoinType {
        return this.getPrivateValue("joinType");
    }

    constructor(options: OffsetOptions) {
        super(options);
        this.setPrivateValue("sectionNodeId", options.sectionNodeId);
        this.setPrivateValue("sectionShapeType", options.sectionShapeType);
        this.setPrivateValue("sectionIndex", options.sectionIndex);
        this.setPrivateValue("distance", options.distance);
        this.setPrivateValue("normal", options.normal);
        this.setPrivateValue("joinType", options.joinType);
    }

    override redirectReference(oldId: string, newId: string): boolean {
        if (this.sectionNodeId !== oldId) return false;
        this.setProperty("sectionNodeId", newId);
        this.setShape(this.generateShape());
        return true;
    }

    /**
     * Re-point this feature at a new section (and/or sub-shape within it),
     * with the offset direction and join type recomputed for it, and
     * recompute once. Used by the "re-pick" edit flow to redirect an existing
     * feature without deleting and recreating it (which would break anything
     * downstream that references it).
     */
    updateSection(
        nodeId: string,
        shapeType: ShapeType | undefined,
        index: number | undefined,
        normal: XYZ,
        joinType: JoinType,
    ) {
        this.setProperty("sectionNodeId", nodeId);
        this.setProperty("sectionShapeType", shapeType);
        this.setProperty("sectionIndex", index);
        this.setProperty("normal", normal);
        this.setProperty("joinType", joinType);
        this.setShape(this.generateShape());
    }

    override get primaryInputId(): string | undefined {
        return this.sectionNodeId;
    }

    override generateShape(): Result<IShape> {
        const base = this.resolveInput(this.sectionNodeId);
        if (!base) return Result.err(`Offset: section shape "${this.sectionNodeId}" no longer exists`);
        if (!base.shape.isOk) return Result.err(base.shape.error);

        this.subscribeTo([base]);

        const ref: SweepRef = {
            nodeId: this.sectionNodeId,
            shapeType: this.sectionShapeType ?? ShapeTypes.shape,
            index: this.sectionIndex ?? -1,
        };
        const sectionResult = resolveSweepRefShape(
            base.shape.value.transformedMul(base.transform),
            ref,
            "Offset",
        );
        if (!sectionResult.isOk) return sectionResult;
        const shape = sectionResult.value;

        if (shape.shapeType === ShapeTypes.edge) {
            return (shape as IEdge).offset(this.distance, this.normal);
        }

        let wire = shape as IWire;
        if (shape.shapeType === ShapeTypes.face) {
            wire = (shape as IFace).outerWire();
        }
        return wire.offset(this.distance, this.joinType);
    }
}
