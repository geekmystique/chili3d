// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IShape,
    type ISubShape,
    property,
    ReferenceShapeNode,
    Result,
    type ShapeType,
    serializable,
    serialize,
} from "@chili3d/core";

export interface ThickSolidOptions {
    document: IDocument;
    sectionNodeId: string;
    /**
     * Present together with sectionIndex only when the picked section is a
     * sub-shape of the base node's own shape (e.g. one face of a multi-face
     * pick) rather than the base node's entire shape.
     */
    sectionShapeType?: ShapeType;
    sectionIndex?: number;
    thickness: number;
}

/**
 * Holds a reference to the base node id (and the picked face's sub-shape
 * type + index within it) rather than a baked face shape. Editing the base
 * node's own parameters recomputes this node. Unlike Extrude/Fillet/etc,
 * ThickSolidCommand does not hide the base node - the shelled result sits
 * alongside it, not in place of it - so the reference always resolves
 * against a node the user can still see and keep editing.
 */
@serializable()
export class ThickSolidNode extends ReferenceShapeNode {
    override display(): I18nKeys {
        return "body.thickSolid";
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
    @property("option.command.thickness")
    get thickness(): number {
        return this.getPrivateValue("thickness");
    }
    set thickness(value: number) {
        this.setPropertyEmitShapeChanged("thickness", value);
    }

    constructor(options: ThickSolidOptions) {
        super(options);
        this.setPrivateValue("sectionNodeId", options.sectionNodeId);
        this.setPrivateValue("sectionShapeType", options.sectionShapeType);
        this.setPrivateValue("sectionIndex", options.sectionIndex);
        this.setPrivateValue("thickness", options.thickness);
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
            return Result.err(`ThickSolid: section index ${this.sectionIndex} no longer exists`);
        }
        return Result.ok(sub);
    }

    override generateShape(): Result<IShape> {
        const base = this.resolveInput(this.sectionNodeId);
        if (!base) return Result.err(`ThickSolid: section shape "${this.sectionNodeId}" no longer exists`);
        if (!base.shape.isOk) return Result.err(base.shape.error);

        this.subscribeTo([base]);

        const sectionResult = this.resolveSection(base.shape.value.transformedMul(base.transform));
        if (!sectionResult.isOk) return sectionResult;

        return shapeFactory.makeThickSolidBySimple(sectionResult.value, this.thickness);
    }
}
