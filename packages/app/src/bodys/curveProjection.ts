// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandKeys,
    I18n,
    type I18nKeys,
    type IDocument,
    type IEdge,
    type IFace,
    type IShape,
    type IWire,
    property,
    ReferenceShapeNode,
    Result,
    type ShapeType,
    serializable,
    serialize,
    XYZ,
} from "@chili3d/core";
import { resolveSweepRefShape, type SweepRef } from "./sweep";

export interface CurveProjectionOptions {
    document: IDocument;
    shapeNodeId: string;
    shapeShapeType: ShapeType;
    shapeIndex: number;
    faceNodeId: string;
    faceShapeType: ShapeType;
    faceIndex: number;
    dir: string;
}

/**
 * Holds references to the curve and target-face node ids (and, for a
 * sub-shape pick, the sub-shape's type + index within each) rather than a
 * baked projected curve. Editing either referenced node's own parameters
 * recomputes this node. Neither source node is hidden - CurveProjectionCommand
 * does not hide them, the projected curve sits alongside both, not in place
 * of them - so the references always resolve.
 */
@serializable()
export class CurveProjectionNode extends ReferenceShapeNode {
    override display(): I18nKeys {
        return "body.curveProjection";
    }

    override get editCommandKey(): CommandKeys {
        return "modify.curveProjectionEdit";
    }

    @serialize()
    get shapeNodeId(): string {
        return this.getPrivateValue("shapeNodeId");
    }

    @serialize()
    get shapeShapeType(): ShapeType {
        return this.getPrivateValue("shapeShapeType");
    }

    @serialize()
    get shapeIndex(): number {
        return this.getPrivateValue("shapeIndex");
    }

    @serialize()
    get faceNodeId(): string {
        return this.getPrivateValue("faceNodeId");
    }

    @serialize()
    get faceShapeType(): ShapeType {
        return this.getPrivateValue("faceShapeType");
    }

    @serialize()
    get faceIndex(): number {
        return this.getPrivateValue("faceIndex");
    }

    @serialize()
    @property("common.dir")
    get dir(): string {
        return this.getPrivateValue("dir");
    }
    set dir(value: string) {
        const nums = value
            .split(",")
            .map(Number)
            .filter((n) => !Number.isNaN(n));
        if (nums.length !== 3) {
            alert(I18n.translate("error.input.threeNumberCanBeInput"));
            return;
        }
        this.setPropertyEmitShapeChanged("dir", value);
    }

    constructor(options: CurveProjectionOptions) {
        super(options);
        this.setPrivateValue("shapeNodeId", options.shapeNodeId);
        this.setPrivateValue("shapeShapeType", options.shapeShapeType);
        this.setPrivateValue("shapeIndex", options.shapeIndex);
        this.setPrivateValue("faceNodeId", options.faceNodeId);
        this.setPrivateValue("faceShapeType", options.faceShapeType);
        this.setPrivateValue("faceIndex", options.faceIndex);
        this.setPrivateValue("dir", options.dir);
    }

    override redirectReference(oldId: string, newId: string): boolean {
        let changed = false;
        if (this.shapeNodeId === oldId) {
            this.setProperty("shapeNodeId", newId);
            changed = true;
        }
        if (this.faceNodeId === oldId) {
            this.setProperty("faceNodeId", newId);
            changed = true;
        }
        if (changed) this.setShape(this.generateShape());
        return changed;
    }

    /**
     * Re-point this feature at a new curve and/or target-face reference (and
     * recompute once). Used by the "re-pick" edit flow to redirect an
     * existing feature without deleting and recreating it (which would break
     * anything downstream that references it).
     */
    updateReferences(shapeRef: SweepRef, faceRef: SweepRef) {
        this.setProperty("shapeNodeId", shapeRef.nodeId);
        this.setProperty("shapeShapeType", shapeRef.shapeType);
        this.setProperty("shapeIndex", shapeRef.index);
        this.setProperty("faceNodeId", faceRef.nodeId);
        this.setProperty("faceShapeType", faceRef.shapeType);
        this.setProperty("faceIndex", faceRef.index);
        this.setShape(this.generateShape());
    }

    /**
     * The curve, not the target face - the curve is the thing being
     * projected, the face is just where it lands, mirroring SectionNode's
     * shape/path split among otherwise-equal inputs.
     */
    override get primaryInputId(): string | undefined {
        return this.shapeNodeId;
    }

    override generateShape(): Result<IShape> {
        const shapeBase = this.resolveInput(this.shapeNodeId);
        if (!shapeBase) return Result.err(`CurveProjection: shape "${this.shapeNodeId}" no longer exists`);
        if (!shapeBase.shape.isOk) return Result.err(shapeBase.shape.error);

        const faceBase = this.resolveInput(this.faceNodeId);
        if (!faceBase) return Result.err(`CurveProjection: face "${this.faceNodeId}" no longer exists`);
        if (!faceBase.shape.isOk) return Result.err(faceBase.shape.error);

        this.subscribeTo([shapeBase, faceBase]);

        const shapeRef: SweepRef = {
            nodeId: this.shapeNodeId,
            shapeType: this.shapeShapeType,
            index: this.shapeIndex,
        };
        const shapeResult = resolveSweepRefShape(
            shapeBase.shape.value.transformedMul(shapeBase.transform),
            shapeRef,
            "CurveProjection",
        );
        if (!shapeResult.isOk) return shapeResult;

        const faceRef: SweepRef = {
            nodeId: this.faceNodeId,
            shapeType: this.faceShapeType,
            index: this.faceIndex,
        };
        const faceResult = resolveSweepRefShape(
            faceBase.shape.value.transformedMul(faceBase.transform),
            faceRef,
            "CurveProjection",
        );
        if (!faceResult.isOk) return faceResult;

        const [x, y, z] = this.dir.split(",").map(Number);
        const dir = new XYZ({ x, y, z }).normalize() as XYZ;

        return shapeFactory.curveProjection(
            shapeResult.value as IEdge | IWire,
            faceResult.value as IFace,
            dir,
        );
    }
}
