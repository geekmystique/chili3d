// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IShape,
    ReferenceShapeNode,
    Result,
    type ShapeType,
    serializable,
    serialize,
} from "@chili3d/core";
import { resolveSweepRefShape, type SweepRef } from "./sweep";

export interface SectionOptions {
    document: IDocument;
    shapeNodeId: string;
    shapeShapeType: ShapeType;
    shapeIndex: number;
    pathNodeId: string;
    pathShapeType: ShapeType;
    pathIndex: number;
}

/**
 * Holds references to the shape and path node ids (and, for a sub-shape
 * pick, the sub-shape's type + index within each) rather than baked
 * intersection input shapes. Editing either referenced node's own parameters
 * recomputes this node. Unlike Boolean/Sweep/Loft, SectionCommand does not
 * hide either source node - the resulting curve sits alongside both, not in
 * place of them - so the references always resolve against nodes the user
 * can still see and keep editing.
 */
@serializable()
export class SectionNode extends ReferenceShapeNode {
    override display(): I18nKeys {
        return "body.section";
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
    get pathNodeId(): string {
        return this.getPrivateValue("pathNodeId");
    }

    @serialize()
    get pathShapeType(): ShapeType {
        return this.getPrivateValue("pathShapeType");
    }

    @serialize()
    get pathIndex(): number {
        return this.getPrivateValue("pathIndex");
    }

    constructor(options: SectionOptions) {
        super(options);
        this.setPrivateValue("shapeNodeId", options.shapeNodeId);
        this.setPrivateValue("shapeShapeType", options.shapeShapeType);
        this.setPrivateValue("shapeIndex", options.shapeIndex);
        this.setPrivateValue("pathNodeId", options.pathNodeId);
        this.setPrivateValue("pathShapeType", options.pathShapeType);
        this.setPrivateValue("pathIndex", options.pathIndex);
    }

    override redirectReference(oldId: string, newId: string): boolean {
        let changed = false;
        if (this.shapeNodeId === oldId) {
            this.setProperty("shapeNodeId", newId);
            changed = true;
        }
        if (this.pathNodeId === oldId) {
            this.setProperty("pathNodeId", newId);
            changed = true;
        }
        if (changed) this.setShape(this.generateShape());
        return changed;
    }

    /**
     * The shape, not the path - neither input is more "base" than the other
     * (both are just intersected), but the first-picked one is the natural
     * place to collapse back to if this feature is deleted, mirroring
     * LoftNode's same choice among otherwise-equal inputs.
     */
    override get primaryInputId(): string | undefined {
        return this.shapeNodeId;
    }

    override generateShape(): Result<IShape> {
        const shapeBase = this.resolveInput(this.shapeNodeId);
        if (!shapeBase) return Result.err(`Section: shape "${this.shapeNodeId}" no longer exists`);
        if (!shapeBase.shape.isOk) return Result.err(shapeBase.shape.error);

        const pathBase = this.resolveInput(this.pathNodeId);
        if (!pathBase) return Result.err(`Section: path shape "${this.pathNodeId}" no longer exists`);
        if (!pathBase.shape.isOk) return Result.err(pathBase.shape.error);

        this.subscribeTo([shapeBase, pathBase]);

        const shapeRef: SweepRef = {
            nodeId: this.shapeNodeId,
            shapeType: this.shapeShapeType,
            index: this.shapeIndex,
        };
        const shapeResult = resolveSweepRefShape(
            shapeBase.shape.value.transformedMul(shapeBase.transform),
            shapeRef,
            "Section",
        );
        if (!shapeResult.isOk) return shapeResult;

        const pathRef: SweepRef = {
            nodeId: this.pathNodeId,
            shapeType: this.pathShapeType,
            index: this.pathIndex,
        };
        const pathResult = resolveSweepRefShape(
            pathBase.shape.value.transformedMul(pathBase.transform),
            pathRef,
            "Section",
        );
        if (!pathResult.isOk) return pathResult;

        return Result.ok(shapeResult.value.section(pathResult.value));
    }
}
